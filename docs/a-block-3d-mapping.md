# A-block 3D mapping: plan

Goal: five or six students sign in on their own phones, open the MirrorCity link, tap **Map**, and film a room. The server turns each recording into a 3D model, places it in a shared A-block model, and the room then works like any other MirrorCity scene: sensors, assets, flood and evacuation scenarios.

Start with one room. Grow to one floor, then the whole block.

## What a phone browser can and can't do

Students will open a link, not install an app, so the capture runs inside Safari or Chrome.

| Phone | What the web page can read |
| --- | --- |
| iPhone (Safari) | Camera video, motion sensors after the user taps "allow". No LiDAR and no ARKit tracking from a web page. |
| Android (Chrome) | Camera video, motion sensors. WebXR with ARCore depth works on many phones, but not all. |

The only input that works on every phone is **camera video**, so build on that. The phone records; a GPU server reconstructs. Don't try to build the 3D model on the phone in real time. It won't work on iPhones, and it would drain the batteries.

## How it works

```text
Phone (browser)                Storage            GPU worker                    MirrorCity
───────────────                ───────            ──────────                    ──────────
Map → pick room → film  ──►  video + sensor  ──►  extract sharp frames
  live guide on screen        log (direct          camera poses (SfM)
  upload in chunks            upload)              scale from markers
                                                   Gaussian splat (looks)
                                                   mesh (geometry)        ──►  room in /room
                                                   align into A-block           whole block in /explore
```

### 1. Capture page (`/map`)

- Clerk handles sign-in. Give the students a `mapper` role in Clerk `publicMetadata`, and only show the **Map** button to mappers.
- The student picks a floor and room from a list an admin sets up (for example `A-1 / 104`). Each student gets their own rooms, so two people don't film the same space twice.
- `getUserMedia` opens the rear camera at 1080p, or 4K where the phone allows. `MediaRecorder` records MP4 on iPhone and WebM on Android.
- The page also logs `DeviceMotion` and `DeviceOrientation` readings with timestamps, which helps the solver with fast turns and blank walls.
- On-screen guide while filming:
  - a timer, with a target of 60 to 120 seconds per room
  - a "too fast" warning from the gyro reading
  - a "too dark" warning from average frame brightness
  - a checklist: walk the walls, then the middle, then point the camera at each marker
- Upload goes straight from the phone to storage through presigned URLs, in chunks, with resume. A Vercel function rejects request bodies over about 4.5 MB, so the video must not pass through the app server.

### 2. Markers for scale and alignment

Print AprilTag sheets on A4 paper, each with a unique ID, and stick them up before anyone films:

- two or three in each room
- one on each side of every doorway, and one at each stair landing

Markers solve two problems at once:

1. **Scale.** A tag has a known printed size, so the model comes out in real metres, not arbitrary units.
2. **Merging.** Two rooms that both saw the doorway tag can be snapped together at that tag. Six students can film six rooms at different times, and the server can still stitch one building.

Write each tag's room and position into a `markers` table. A printed floor plan of A block, if the college has one, gives a second check on the layout.

### 3. Reconstruction (GPU worker)

Vercel can't run this. Run a worker on a machine with an NVIDIA GPU: a college lab PC, or a rented cloud GPU billed per job. The worker pulls jobs from a queue and runs:

1. **Frames.** Extract about 2 to 3 frames per second with ffmpeg and drop the blurry ones (Laplacian variance).
2. **Camera poses.** COLMAP with its global mapper (GLOMAP), seeded with the phone's motion log. If COLMAP fails on blank corridor walls, try a learned model such as VGGT or MASt3R, which handle low texture better. Test both on our first room.
3. **Scale.** Detect the AprilTags in the frames and scale the poses to metres.
4. **Appearance.** Train a Gaussian splat (gsplat or Nerfstudio `splatfacto`). The splat looks like a photo from any angle. Output `.spz` or `.ply`.
5. **Geometry.** Build a mesh as well (2D Gaussian splatting or OpenMVS), then simplify it and export GLB. Measurements, collisions, flood water, sensor placement and clicking on walls all need a mesh; a splat alone can't do them.
6. **Alignment.** Use the shared doorway tags to fit each room into the A-block frame, then run a global pose-graph adjustment so the errors spread out instead of piling up at the far end of the corridor.
7. **Quality report.** Record frame count, share of frames registered, reprojection error and marker error in centimetres. If the room fails, tell the student what to fix ("film the north wall again").

Budget a few minutes to about half an hour of GPU time per room, depending on the GPU and the video length.

### 3b. Refinement: from a rough scan to a clean, labelled room

A raw scan has floating blobs, wavy walls, holes behind furniture, and no idea what anything is. The refinement stages fix that. They run on the same GPU worker, after step 7, and each one writes its own output so we can re-run any stage later with a better model.

**Geometry clean-up (on the GPU, no external API)**

8. **Depth priors during training.** Run a monocular depth model (Depth Anything V2 or a metric-depth model) on each frame and add depth and normal losses while training the splat. Blank walls and floors, where COLMAP finds few points, come out flat instead of lumpy.
9. **Floater removal.** Prune low-opacity Gaussians and any Gaussian seen from fewer than N cameras.
10. **Planes.** Fit planes to floor, ceiling and walls with RANSAC, rotate the room so walls line up with the axes, and snap mesh vertices near a plane onto it. Rooms in a college block are boxes; the model should say so.
11. **Holes.** Fill small holes in the mesh. For areas the camera barely saw, try a diffusion-based fixer such as Difix3D+ on the rendered views and retrain. Mark this stage experimental: it invents detail, so the app must label fixed areas as "estimated".
12. **Textures and levels of detail.** Bake the splat colours onto the mesh, then export three GLB sizes (phone, laptop, full) so the block loads fast on a phone.

**Understanding what's in the room (Gemini or another vision model)**

13. **Masks.** Run SAM 2 across the frames to get object masks that stay consistent from frame to frame.
14. **Labels from Gemini.** Send 20 to 40 keyframes per room to the Gemini API, after blurring faces. Ask for structured JSON: each object's name (whiteboard, projector, AC unit, fire extinguisher, socket, bench, door, window), a bounding box, its condition, and any text it can read, such as room numbers, notice boards or the label on an electrical panel. Keep the model name in config, so we can swap in a newer Gemini or a different vision model without code changes.
15. **Lift labels into 3D.** We know each frame's camera pose, so project every 2D mask into the scene and let the frames vote. Each object ends up as a 3D instance with a label, a position, a size and a confidence score.
16. **Room inventory.** Write `inventory.json` per room: object, class, position, size, count, confidence, and the frames it came from. This becomes the record of what's in A block: how many benches in 104, where every extinguisher is, which rooms have projectors.
17. **AI review.** Render the finished room from the original camera positions and ask Gemini to compare each render with the matching real frame. It flags missing walls, smeared areas and wrong labels, and writes the re-film instruction for the student ("the corner behind the door is missing"). The numeric scores from step 7 stay the pass/fail gate; Gemini's review explains the failure.

**Human sign-off**

18. **Review in the app.** An admin opens the room, checks the inventory, fixes wrong labels, and approves it. Only approved rooms go into the A-block model.

**Keep everything**

19. **Versioned storage.** Store the raw video, motion log, frames, poses, splat, meshes, masks, labels, inventory and reports under `captures/<id>/v<n>/`. When a better reconstruction model comes out, we re-run the pipeline on the same videos without filming again.

Gemini needs an API key, which lives only on the worker, never in the browser. Each room costs a few dozen image calls. Frames leave our servers for Google, so students and room occupants must know and agree, and faces get blurred first.

### 4. Viewing in MirrorCity

- **One room.** `/room` already loads `rooms.glbPath` and overlays live sensors. Point `glbPath` at the new mesh and draw the splat on top with a three.js splat renderer (Spark or GaussianSplats3D).
- **Whole block.** Once there are more than a handful of rooms, package them as 3D Tiles. `3d-tiles-renderer` is already a dependency, so the viewer streams only the rooms in view.
- **Outside.** Place the block on its real coordinates so it lines up with the OpenStreetMap building in `/explore`.

### 5. Data model

New tables, all in the existing Drizzle schema:

- `buildings`: name, lat/lon, rotation
- `floors`: building, level, floor height
- `rooms`: add `floorId`, `splatPath`, `status`, and the room's transform within the building
- `captures`: room, user, video key, motion-log key, device, duration, status, quality report
- `markers`: tag ID, room, position, printed size
- `jobs`: capture, stage, progress, error, log key

Over time, rooms, walls, doors and fixtures become objects you can click, and the existing sensors, assets and scenarios attach to them.

## For team members with a GPU

Anyone with an NVIDIA GPU can run the reconstruction worker on their own machine, and the more machines we have, the faster the block gets done.

**You need**

- an NVIDIA GPU with 8 GB of VRAM at minimum; 12 to 24 GB trains splats much faster
- Linux, or Windows with WSL2
- the NVIDIA driver, CUDA 12, Docker and the NVIDIA Container Toolkit
- about 50 GB of free disk space

Apple Silicon Macs can run COLMAP and the Gemini stages, but splat training needs CUDA, so Macs can't run the full pipeline yet.

**Proposed layout** (to be built in Phase 2)

```text
worker/recon/
  Dockerfile          # CUDA, COLMAP, gsplat, SAM 2, ffmpeg, AprilTag detector
  pipeline.py         # stages 1 to 19, each one skippable and re-runnable
  stages/             # one file per stage
  config.example.toml # API URL, worker token, Gemini model and key, GPU limits
```

**Two ways to run it**

1. **Offline, from day one.** Film a room, copy the video to your machine, and run:
   ```bash
   docker run --gpus all -v $PWD/data:/data mirrorcity-recon run /data/room104.mp4
   ```
   You get the splat, meshes, inventory and report in `data/out/`. Use this for the Phase 0 spike before the queue exists.
2. **As a queue worker.** Once Phase 2 lands, start the container with a worker token. It asks MirrorCity for the next capture, downloads the video from storage, runs the pipeline, uploads the results and reports progress, which students see live in the app. Several workers can run at once; each one claims a job, so no two machines process the same room.

## Blockers to fix first

1. **No database on Vercel.** `db/index.ts` needs a Cloudflare D1 binding, and Vercel doesn't provide one, so nothing saves on the live site today. Pick one:
   - Turso (libSQL). It speaks SQLite, so the Drizzle schema stays almost the same. This is the smallest change.
   - Deploy back to Cloudflare Workers, where D1 and R2 already exist (`npm run build:workers`).
2. **No file storage.** `/api/uploads` records metadata only. Add an object store: Cloudflare R2 is S3-compatible and doesn't charge for downloads, which matters because every visitor will download models.
3. **No GPU.** Find out whether the college has a GPU machine the team can use.

## Phases

| Phase | Output | Done when |
| --- | --- | --- |
| 0. Spike, 1 week | One room filmed on one iPhone and one Android phone, reconstructed by hand on a GPU machine | We can open both results in `/room` and they measure within 5 cm of a tape measure |
| 1. Capture page | `/map` with sign-in, room picker, guided recording and resumable upload | A student films a room and the video lands in storage, no help needed |
| 2. Worker | Docker worker for GPU owners, queue, and stages 1 to 7 running unattended, with status shown in the app | A capture becomes a viewable room with a quality report |
| 2b. Refinement | Stages 8 to 19: clean geometry, Gemini labels, 3D inventory, admin sign-off | A room shows flat walls, labelled objects you can click, and an inventory list |
| 3. One floor | Markers at every doorway, rooms aligned into one floor | Walking the corridor in 3D shows no visible seams between rooms |
| 4. Whole block | All floors and stairs, 3D Tiles, placed on the map | The full A block streams on a phone |
| 5. Use it | Sensors, assets, evacuation and flood scenarios on the real building | An evacuation run uses A-block corridors and stairs |

## Capture rules for students

- Turn on every light. Open the curtains, but don't film straight into a sunlit window.
- Walk slowly, about one step a second. Keep the phone upright at chest height.
- Do one lap along the walls with the camera pointing inward, then one lap through the middle.
- Point the camera at every marker for two seconds.
- Mirrors, glass and blank white walls cause trouble. Film them at an angle, and make sure some textured object is always in frame.
- Keep people out of the shot, and get permission before filming any occupied room. Stored footage of faces needs a policy: blur faces in the worker before saving frames.

## Open questions

- Which database fix: Turso or back to Cloudflare?
- Which GPU: a college machine or a cloud service?
- Does the college have an A-block floor plan, and can we use it?
- Who prints and places the markers, and how many rooms are in A block?
- Who has an NVIDIA GPU, and how much VRAM? Reply on this issue.
- Who pays for the Gemini API, and is there a college or student credit we can use?
