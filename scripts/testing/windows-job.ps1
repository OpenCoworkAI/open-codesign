param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'

# Workflow-only process ownership. This does not isolate a Windows desktop or input.
# Create suspended -> assign to job -> resume: the child cannot spawn outside the job first.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CodesignTestJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int Size; public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public short Show, ReservedSize; public IntPtr ReservedPtr, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread; public uint Pid, Tid;
  }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
    public int Size; public IntPtr Descriptor; public int Inherit;
  }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes attributes, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref ExtendedLimits i, int s);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j, int c, out Accounting i, int s, IntPtr r);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr j, uint c);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string a, StringBuilder c, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup s, out ProcessInfo p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p, out uint c);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr p, uint c);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int k);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr h, uint m, uint f);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var b = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') b.Append('\\', slashes * 2 + 1);
      else b.Append('\\', slashes);
      b.Append(c); slashes = 0;
    }
    return b.Append('\\', slashes * 2).Append('"').ToString();
  }
  public static int Run(string exe, string[] args, string cwd, string report) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
    var process = new ProcessInfo(); bool assigned = false; uint code = 1; IntPtr input = IntPtr.Zero;
    try {
      var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
      Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits)));
      var start = new Startup(); start.Size = Marshal.SizeOf(start); start.Flags = 0x100;
      // Keep the control pipe private. Tests get EOF, never a console or the user's keyboard.
      var security = new SecurityAttributes(); security.Size = Marshal.SizeOf(security); security.Inherit = 1;
      input = CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
      Check(input != new IntPtr(-1));
      start.Input = input; start.Output = GetStdHandle(-11); start.Error = GetStdHandle(-12);
      Check(SetHandleInformation(start.Output, 1, 1)); Check(SetHandleInformation(start.Error, 1, 1));
      var command = new StringBuilder(Quote(exe));
      foreach (var arg in args) command.Append(' ').Append(Quote(arg));
      Check(CreateProcessW(exe, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004,
        IntPtr.Zero, cwd, ref start, out process));
      Check(AssignProcessToJobObject(job, process.Process)); assigned = true;
      Check(ResumeThread(process.Thread) != UInt32.MaxValue);
      // Parent closes the pipe on timeout/cancel; parent death also causes EOF.
      var stop = System.Threading.Tasks.Task.Run(() => Console.In.ReadLine());
      while (WaitForSingleObject(process.Process, 50) == 258 && !stop.IsCompleted) {}
      if (WaitForSingleObject(process.Process, 0) == 0) Check(GetExitCodeProcess(process.Process, out code));
      else code = 130;
      Check(TerminateJobObject(job, 130));
      Accounting accounting; bool cleaned = false;
      for (int i = 0; i < 100; i++) {
        Check(QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        if (accounting.ActiveProcesses == 0) { cleaned = true; break; }
        Thread.Sleep(50);
      }
      System.IO.File.WriteAllText(report, "{\"schemaVersion\":1,\"pid\":" + process.Pid +
        ",\"exitCode\":" + code + ",\"cleanup\":" + (cleaned ? "true" : "false") + "}");
      return cleaned ? (int)code : 1;
    } finally {
      if (!assigned && process.Process != IntPtr.Zero) TerminateProcess(process.Process, 1);
      CloseHandle(job);
      if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input);
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
    }
  }
}
'@
try {
  $settings = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
  $result = [CodesignTestJob]::Run($settings.exe, [string[]]$settings.args, $settings.cwd, $settings.report)
  exit $result
} catch {
  # Avoid command/environment dumps from PowerShell's normal error formatter.
  [Console]::Error.WriteLine('UI_TEST_JOB_FAILED: could not supervise the owned process tree')
  exit 1
}
