# IITH LiDAR terrain models

These models were generated from the user-supplied `IITH_LiDAR_ground_dataset_labelled_raw.zip` archive. Ground points are identified from the dataset's red labels; green non-ground points are retained in separate labelled-context PLY files.

The bundle contains low-, medium-, and high-slope terrain captures. Each is provided as GLB, OBJ, mesh PLY, source point-cloud PLY, labelled-context PLY, and PNG preview. See `manifest.json` for geometry counts and fitted grades.

Run `scripts/reconstruct_iith_ground_models.py` with the labelled dataset directory to reproduce the outputs. Confirm the original dataset's terms before redistributing derived files.
