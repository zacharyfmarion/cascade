# Technical Debt

## Asset references

Cascade now treats bundled media as project assets and exposes packed assets in DSL with
`asset://sha256/<hash>` URIs. For compatibility, those URIs are still stored in existing string
loader params such as `path` and `file_path`.

This is an intentional intermediate step. It gives bundled projects stable, portable DSL without
forcing a large migration through every graph, bridge, UI control, and document serializer.

The desired end state is a true first-class `AssetRef` param model. Loader nodes should reference
an asset resource directly, with variants for external files, packed blobs, and web-imported assets.
At that point `asset://` becomes only a DSL/display format, not the core representation.
