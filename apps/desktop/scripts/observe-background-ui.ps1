param(
  [Parameter(Mandatory=$true)][string]$ControlDirectory,
  [switch]$Stream
)
$ErrorActionPreference = 'Stop'
# Observation only: no key values, window titles, screenshots, or input injection.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Diagnostics;

public static class BackgroundUiObserver {
  delegate void WinEvent(IntPtr hook, uint kind, IntPtr window, int obj, int child, uint thread, uint time);
  delegate IntPtr InputHook(int code, IntPtr message, IntPtr data);
  delegate bool EnumWindow(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr Window; public uint Id; public UIntPtr W; public IntPtr L; public uint Time; public Point P; public uint Private; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point P; public uint Data, Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct Keyboard { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
    public uint Size, Usage, Id; public UIntPtr Heap; public uint Module, Threads, Parent; public int Priority; public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
  }
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEvent callback, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, InputHook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static Dictionary<uint,uint> Parents() {
    var result = new Dictionary<uint,uint>();
    var snapshot = CreateToolhelp32Snapshot(2, 0);
    try {
      var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
      if (Process32FirstW(snapshot, ref entry)) do { result[entry.Id] = entry.Parent; } while (Process32NextW(snapshot, ref entry));
    } finally { CloseHandle(snapshot); }
    return result;
  }
  static uint[] Ancestors(uint pid, Dictionary<uint,uint> parents) {
    var result = new List<uint>();
    while (pid != 0 && !result.Contains(pid) && result.Count < 64) {
      result.Add(pid); uint parent; if (!parents.TryGetValue(pid, out parent)) break; pid = parent;
    }
    return result.ToArray();
  }
  public static object Run(string directory, bool stream) {
    var events = new List<Tuple<uint,uint[]>>();
    int injectedMouse = 0, injectedKeyboard = 0, visibleSamples = 0, focusSamples = 0, samples = 0, cursorJumpSamples = 0;
    bool overflow = false;
    uint target = 0;
    int visibleEvents = 0, foregroundEvents = 0;
    Point start, end, previous; GetCursorPos(out start); previous = start;
    IntPtr initialForeground = GetForegroundWindow();
    WinEvent callback = (hook, kind, window, obj, child, thread, time) => {
      if (window == IntPtr.Zero || (kind == 0x8002 && obj != 0)) return;
      uint pid; GetWindowThreadProcessId(window, out pid);
      var ancestors = Ancestors(pid, Parents());
      if (target != 0) {
        if (ancestors.Contains(target)) { if (kind == 0x8002) visibleEvents++; else foregroundEvents++; }
      } else if (events.Count < 10000) events.Add(Tuple.Create(kind, ancestors)); else overflow = true;
    };
    InputHook mouse = (code, msg, data) => {
      if (code >= 0 && (Marshal.PtrToStructure<Mouse>(data).Flags & 1) != 0) injectedMouse++;
      return CallNextHookEx(IntPtr.Zero, code, msg, data);
    };
    InputHook keyboard = (code, msg, data) => {
      if (code >= 0 && (Marshal.PtrToStructure<Keyboard>(data).Flags & 16) != 0) injectedKeyboard++;
      return CallNextHookEx(IntPtr.Zero, code, msg, data);
    };
    var foregroundHook = SetWinEventHook(3, 3, IntPtr.Zero, callback, 0, 0, 0);
    var showHook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, callback, 0, 0, 0);
    var mouseHook = SetWindowsHookEx(14, mouse, GetModuleHandle(null), 0);
    var keyboardHook = SetWindowsHookEx(13, keyboard, GetModuleHandle(null), 0);
    var hooksReady = foregroundHook != IntPtr.Zero && showHook != IntPtr.Zero && mouseHook != IntPtr.Zero && keyboardHook != IntPtr.Zero;
    bool completed;
    try {
      if (!hooksReady) throw new Exception("Windows observation hooks unavailable");
      File.WriteAllText(Path.Combine(directory, "ready"), "ready");
      var deadline = DateTime.UtcNow.AddMinutes(65);
      int owner = int.Parse(File.ReadAllText(Path.Combine(directory, "owner")));
      var nextUpdate = DateTime.UtcNow;
      while (!File.Exists(Path.Combine(directory, "stop")) && DateTime.UtcNow < deadline) {
        try { if (Process.GetProcessById(owner).HasExited) break; } catch (ArgumentException) { break; }
        Message message;
        while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
        if (target == 0 && File.Exists(Path.Combine(directory, "pid"))) {
          // A sharing violation is transient while a writer/antivirus holds the marker.
          // Without a PID and positive samples the final observation cannot pass.
          try { uint.TryParse(File.ReadAllText(Path.Combine(directory, "pid")), out target); }
          catch (IOException) { }
          if (target != 0) {
            visibleEvents += events.Count(e => e.Item1 == 0x8002 && e.Item2.Contains(target));
            foregroundEvents += events.Count(e => e.Item1 == 3 && e.Item2.Contains(target));
            events.Clear();
          }
        }
        if (target != 0) {
          var parents = Parents();
          EnumWindows((window, data) => {
            uint pid; GetWindowThreadProcessId(window, out pid);
            if (IsWindowVisible(window) && Ancestors(pid, parents).Contains(target)) visibleSamples++;
            return true;
          }, IntPtr.Zero);
          uint focused; GetWindowThreadProcessId(GetForegroundWindow(), out focused);
          if (Ancestors(focused, parents).Contains(target)) focusSamples++;
          Point cursor; GetCursorPos(out cursor);
          // Instant cursor teleports move far in one poll without LLMHF_INJECTED.
          // Informational only: ordinary user flicks can also trip this.
          if (Math.Abs(cursor.X - previous.X) + Math.Abs(cursor.Y - previous.Y) >= 80) cursorJumpSamples++;
          previous = cursor;
          samples++;
          if (stream && DateTime.UtcNow >= nextUpdate) {
            Console.WriteLine("{\"platform\":\"win32\",\"available\":true,\"completed\":false,\"samples\":" + samples +
              ",\"overflow\":" + overflow.ToString().ToLowerInvariant() + ",\"visibleWindowEvents\":" + visibleEvents +
              ",\"foregroundEvents\":" + foregroundEvents + ",\"visibleSamples\":" + visibleSamples +
              ",\"focusSamples\":" + focusSamples + ",\"injectedMouse\":" + injectedMouse + ",\"injectedKeyboard\":" + injectedKeyboard + ",\"cursorJumpSamples\":" + cursorJumpSamples + "}");
            nextUpdate = DateTime.UtcNow.AddMilliseconds(250);
          }
        }
        Thread.Sleep(20);
      }
      completed = File.Exists(Path.Combine(directory, "stop"));
      GetCursorPos(out end);
    } finally {
      UnhookWinEvent(foregroundHook); UnhookWinEvent(showHook);
      UnhookWindowsHookEx(mouseHook); UnhookWindowsHookEx(keyboardHook);
      GC.KeepAlive(callback); GC.KeepAlive(mouse); GC.KeepAlive(keyboard);
    }
    return new {
      platform = "win32", available = true, completed, samples, overflow,
      visibleWindowEvents = visibleEvents,
      foregroundEvents = foregroundEvents,
      visibleSamples, focusSamples, injectedMouse, injectedKeyboard, cursorJumpSamples,
      cursorUnchanged = start.X == end.X && start.Y == end.Y,
      foregroundUnchanged = initialForeground == GetForegroundWindow()
    };
  }
}
'@
[BackgroundUiObserver]::Run($ControlDirectory, $Stream.IsPresent) | ConvertTo-Json -Compress -Depth 4
