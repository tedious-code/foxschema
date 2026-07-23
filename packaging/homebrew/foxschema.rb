# Homebrew formula for Fox Schema CLI (browser launcher).
# Install:
#   brew tap tedious-code/foxschema https://github.com/tedious-code/homebrew-foxschema
#   brew install foxschema
#
# This formula installs the published npm package globally under Homebrew's
# prefix, so both Apple Silicon and Intel Macs get the correct Node native
# addons for their arch. DB2 (ibm_db) is NOT included — use
# `foxschema drivers install db2` or Docker `5nickels/foxschema:db2-latest`.

class Foxschema < Formula
  desc "Fox Schema — database schema diff & migration (local web UI)"
  homepage "https://foxschema.com"
  url "https://registry.npmjs.org/foxschema/-/foxschema-0.1.66.tgz"
  # shasum -a 256 of the npm tarball; refreshed by packaging/homebrew/update-formula.sh
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
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
