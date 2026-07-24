# Homebrew formula for Fox Schema CLI (browser launcher).
# Same repo as the app — no separate tap repository.
#
#   brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
#   brew trust tedious-code/foxschema   # Homebrew 6+ (third-party taps)
#   brew install foxschema
#
# Installs the published npm package under Homebrew's prefix so Arm and Intel
# Macs get the correct Node native addons. ibm_db is an optionalDependency.
# Docker: 5nickels/foxschema:latest (linux/amd64, includes Db2).

class Foxschema < Formula
  desc "Fox Schema — database schema diff & migration (local web UI)"
  homepage "https://foxschema.com"
  url "https://registry.npmjs.org/foxschema/-/foxschema-0.1.79.tgz"
  # shasum -a 256 of the npm tarball; refreshed by packaging/homebrew/update-formula.sh
  sha256 "8491ce9be9acb000d435e63c112c7bd9029ec6bef322f688e08af7510245b30d"
  license "Apache-2.0"

  depends_on "node@22"

  def install
    system "npm", "install", "-ddd", "--global", "--build-from-source",
           "--prefix=#{libexec}", "foxschema@#{version}"
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/foxschema --version")
  end
end
