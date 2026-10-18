{
  description = "Citation core shared by Due Credit and its sibling Obsidian plugins";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        package = builtins.fromJSON (builtins.readFile ./package.json);
      in
      {
        # Nothing to build: plugins bundle the source. The check is the type
        # check, the lint and the tests, against nixpkgs' pandoc, which is the
        # one the plugins' CI pins.
        checks.default = pkgs.buildNpmPackage {
          pname = package.name;
          inherit (package) version;
          src = ./.;
          # Update with: nix run nixpkgs#prefetch-npm-deps -- package-lock.json
          npmDepsHash = "sha256-t2cM0hRohOHP2U8jKjx93KMwuMkjefHItk/vW5qERIY=";
          nodejs = pkgs.nodejs_24;
          nativeBuildInputs = [ pkgs.pandoc ];
          buildPhase = ''
            runHook preBuild
            npm run typecheck
            npm run lint
            npm test
            runHook postBuild
          '';
          installPhase = "touch $out";
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
            pkgs.pandoc
          ];
        };
      }
    );
}
