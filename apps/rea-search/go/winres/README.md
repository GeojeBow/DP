Windows resources (icon, manifest, version) for REASearch.exe.

`icon.svg` is the source; the PNGs are it rendered at each size. The
`rsrc_windows_amd64.syso` next to the Go files is built from `winres.json`
with go-winres (`go-winres make --in winres/winres.json --arch amd64 --out rsrc`)
and is picked up by `go build` automatically.
