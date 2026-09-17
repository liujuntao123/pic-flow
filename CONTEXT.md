# pic-flow

A pipeline for black-and-white sketch narrative and deep-dive infographic long images, driven by declarative layout, sprite-sheet generation, and automated multi-pass inspection.

## Language

### Canvas & Structure

**Long Image**:
The continuous vertical image canvas seamlessly stitched from sequential blocks, adhering to the containerless scroll principle without card borders.
_Avoid_: Poster, infographic, roll

**Block**:
An independent vertical segment of a long image with standard width (typically 1080px) and variable height, containing its own layout definition and rendered as an intermediate PNG.
_Avoid_: Slide, frame, section, panel

**Layout**:
A declarative JSON document specifying the dimensions, elements, typography styles, and coordinate anchors for a single block.
_Avoid_: Template, config, design schema

### Graphics & Assets

**Sheet**:
A composite 2×2 grid image produced in a single generation round by an image model, containing four distinct illustrations separated by generous white space for automatic slicing.
_Avoid_: Sprite sheet, atlas, grid image

**Asset**:
An individual transparent PNG illustration obtained by slicing a sheet or direct full-bleed generation, placed onto the block canvas.
_Avoid_: Image, icon, clip, sprite

### Quality & Verification

**Inspection**:
The automated multi-rule verification chain checking bounding-box collision (lint), font wrapping and geometry (geom), and pixel-level ink occlusion and clearance.
_Avoid_: Linter, validation suite, unit tests

**Inspection Report**:
A structured diagnostic result summarizing pass/fail status, violation severity counts, affected element indices, and corrective coordinates for a block layout.
_Avoid_: Log output, stdout dump
