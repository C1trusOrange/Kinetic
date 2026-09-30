#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for id in pistol rifle shotgun sniper rocket; do
  python tools/run.py "tools/viewer.html?kind=viewmodel&id=$id&ads=1" --wait "window.__VIEWER_READY__" --shot tools/out/audit/review-assets/ads_$id.png --quiet --size 1280x720 > tools/out/audit/review-assets/ads_$id.log 2>&1
  python tools/run.py "tools/viewer.html?kind=viewmodel&id=$id" --wait "window.__VIEWER_READY__" --shot tools/out/audit/review-assets/hip_$id.png --quiet --size 1280x720 > tools/out/audit/review-assets/hip_$id.log 2>&1
done
python tools/run.py "tools/viewer.html?kind=weapons" --wait "window.__VIEWER_READY__" --shot tools/out/audit/review-assets/world_all.png --quiet --size 1280x900 > tools/out/audit/review-assets/world_all.log 2>&1
echo done > tools/out/audit/review-assets/shots.done
