# MirrorCity LiDAR model bundle

Generated from the ten labeled Velodyne scans in the user-supplied `project-example.zip` archive using Open3D 0.19.0 and `scripts/reconstruct_lidar_models.py`.

## Models

- `road-terrain`: triangulated road, parking, sidewalk, lane-marking, and terrain surface.
- `building-masses`: nine clustered building and structure volumes.
- `street-assets`: forty vehicle, trunk, pole, and traffic-asset objects.

Each model is available as web-ready GLB, editable OBJ, binary mesh PLY, source point-cloud PLY, and a PNG preview. `registered-semantic-corridor.ply` contains the combined semantic point cloud from all ten registered scans.

These outputs are derived from data supplied for this project. Confirm the original dataset's redistribution and commercial-use terms before publishing the model files outside the project.
