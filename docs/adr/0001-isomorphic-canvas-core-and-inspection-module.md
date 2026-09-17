# Isomorphic Canvas Core and Structured Inspection Module

To eliminate dual-engine layout drift between the Node.js rendering pipeline and the browser Web workbench, layout measurement and vector rendering logic are consolidated into an isomorphic core module shared via ES module imports without a bundler build step. In addition, the four scattered layout checks (lint, geom, occlusion, clearance) are unified into a single deep inspection module that calculates raster distance fields once and returns structured diagnostic reports, eliminating stdout monkey-patching in the Web server.
