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

        # The pandoc the tests pin, 3.13, the built-in one's version
        # (src/core/built-in.ts): pandoc's own static build, since nixpkgs
        # has an older one. On Linux, where CI runs.
        native =
          {
            x86_64-linux = {
              arch = "amd64";
              hash = "sha256-OKozsyWivJakw5QJYxIS21VwL1ZCULzb6tGAs79kY4k=";
            };
            aarch64-linux = {
              arch = "arm64";
              hash = "sha256-IeHUugm9CzNFkNIEWA/U9mKbIb5KtqMrJsyYmC6eDGg=";
            };
          }
          .${system} or (throw "The pinned pandoc is pandoc's Linux build; ${system} has none here.");
        pandoc = pkgs.stdenvNoCC.mkDerivation {
          pname = "pandoc";
          version = "3.13";
          src = pkgs.fetchurl {
            url = "https://github.com/jgm/pandoc/releases/download/3.13/pandoc-3.13-linux-${native.arch}.tar.gz";
            inherit (native) hash;
          };
          installPhase = ''
            mkdir -p $out/bin
            cp bin/pandoc $out/bin/
          '';
        };

        # The built-in pandoc, from the same release as a plugin downloads it,
        # by the same hash.
        pandocWasm = pkgs.runCommand "pandoc-3.13.wasm" { nativeBuildInputs = [ pkgs.unzip ]; } ''
          unzip -p ${
            pkgs.fetchurl {
              url = "https://github.com/jgm/pandoc/releases/download/3.13/pandoc-3.13-wasm.zip";
              hash = "sha256-I00gIKfzqaqzh7013zwXyiugB4qCSQ4rPt6JDWSNZP4=";
            }
          } pandoc-3.13-wasm/pandoc.wasm > $out
        '';

        # The built-in pandoc as a `pandoc` command, for the whole suite.
        pandocBuiltIn = pkgs.writeShellScriptBin "pandoc" ''
          exec ${pkgs.nodejs_24}/bin/node --no-warnings ${./scripts/pandoc-wasm.mjs} "$@"
        '';
      in
      {
        # Nothing to build: plugins bundle the source. The check is the type
        # check, the lint and the tests, against the pinned pandoc, and the
        # tests again against the built-in one.
        checks.default = pkgs.buildNpmPackage {
          pname = package.name;
          inherit (package) version;
          src = ./.;
          # Update with: nix run nixpkgs#prefetch-npm-deps -- package-lock.json
          npmDepsHash = "sha256-L7U40RCumVr1ESEl5menNYheOs6iJg63B/tfk6FUbxw=";
          nodejs = pkgs.nodejs_24;
          nativeBuildInputs = [ pandoc ];
          PANDOC_WASM = pandocWasm;
          buildPhase = ''
            runHook preBuild
            npm run typecheck
            npm run lint
            npm test
            PATH=${pandocBuiltIn}/bin:$PATH PANDOC_BUILT_IN=1 npm test
            runHook postBuild
          '';
          installPhase = "touch $out";
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
            pandoc
          ];
          # tests/wasm.test.ts runs the built-in pandoc from here.
          PANDOC_WASM = pandocWasm;
        };
      }
    );
}
