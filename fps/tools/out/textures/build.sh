#!/bin/sh
cd /c/Users/caleb/Desktop/AiProject/fps/tools/out/textures
cat part1.js part2.js $(ls part[3-9].js 2>/dev/null) tail.js > /c/Users/caleb/Desktop/AiProject/fps/src/world/Textures.js
