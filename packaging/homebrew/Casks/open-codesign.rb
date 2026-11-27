cask "open-codesign" do
  version "0.3.0"

  on_arm do
    url "https://github.com/OpenCoworkAI/open-codesign/releases/download/v#{version}/open-codesign-#{version}-arm64.dmg",
        verified: "github.com/OpenCoworkAI/open-codesign/"
    sha256 "56385717cd719d361734d65c75caf0b84ad73791cf04500d499ca0cfd2ca22bb"
  end

  name "Open CoDesign"
  desc "Open-source desktop AI design tool — prompt to prototype, BYOK, local-first"
  homepage "https://opencoworkai.github.io/open-codesign/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates false
  depends_on arch: :arm64
  depends_on macos: :big_sur

  app "Open CoDesign.app"

  # Unsigned build — macOS will refuse the first launch with a generic
  # "damaged, move to Trash" dialog. Code-signing + notarization is on the
  # Stage-2 roadmap; until then users need the xattr workaround below.
  caveats <<~EOS
    #{token} is not yet notarized. On first launch macOS may refuse to open
    it. To bypass, either right-click the app and choose Open, or run:

      xattr -d com.apple.quarantine /Applications/Open CoDesign.app

    You only need to do this once per install/update.
  EOS

  zap trash: [
    "~/Library/Application Support/open-codesign",
    "~/Library/Preferences/ai.opencowork.codesign.plist",
    "~/Library/Logs/open-codesign",
    "~/Library/Saved Application State/ai.opencowork.codesign.savedState",
  ]
end
