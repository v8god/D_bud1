import fs from "node:fs";
import path from "node:path";

const root = path.resolve(
  process.argv[2] ??
    "public/assets/character/character_extensions/motions/director",
);

const LINEAR = 0;
const BEZIER = 1;
const STEPPED = 2;
const INVERSE_STEPPED = 3;

function readSegmentCurve(segments, file, curveId) {
  if (!Array.isArray(segments) || segments.length < 5) {
    throw new Error(`${file}: ${curveId}: Segments must contain at least two points.`);
  }

  let cursor = 0;
  let points = 1;
  let segmentCount = 0;
  let previousTime = Number(segments[cursor++]);
  const initialValue = Number(segments[cursor++]);

  if (!Number.isFinite(previousTime) || !Number.isFinite(initialValue)) {
    throw new Error(`${file}: ${curveId}: Invalid initial point.`);
  }

  while (cursor < segments.length) {
    const type = Number(segments[cursor++]);
    let endpointTime;

    if (type === LINEAR || type === STEPPED || type === INVERSE_STEPPED) {
      if (cursor + 1 >= segments.length) {
        throw new Error(`${file}: ${curveId}: Truncated segment.`);
      }
      endpointTime = Number(segments[cursor]);
      const endpointValue = Number(segments[cursor + 1]);
      if (!Number.isFinite(endpointTime) || !Number.isFinite(endpointValue)) {
        throw new Error(`${file}: ${curveId}: Invalid segment endpoint.`);
      }
      cursor += 2;
      points += 1;
    } else if (type === BEZIER) {
      if (cursor + 5 >= segments.length) {
        throw new Error(`${file}: ${curveId}: Truncated Bezier segment.`);
      }
      const values = segments.slice(cursor, cursor + 6).map(Number);
      if (!values.every(Number.isFinite)) {
        throw new Error(`${file}: ${curveId}: Invalid Bezier control point.`);
      }
      endpointTime = values[4];
      cursor += 6;
      points += 3;
    } else {
      throw new Error(`${file}: ${curveId}: Invalid segment type ${type}.`);
    }

    if (!(endpointTime > previousTime)) {
      throw new Error(
        `${file}: ${curveId}: Segment times must increase (${previousTime} -> ${endpointTime}).`,
      );
    }

    previousTime = endpointTime;
    segmentCount += 1;
  }

  return { segmentCount, pointCount: points, finalTime: previousTime };
}

if (!fs.existsSync(root)) {
  console.error(`Motion folder not found: ${root}`);
  process.exit(1);
}

const files = fs
  .readdirSync(root)
  .filter((name) => name.endsWith(".motion3.json"))
  .sort();

let failures = 0;
let totalCurves = 0;
let totalSegments = 0;
let totalPoints = 0;

for (const name of files) {
  const file = path.join(root, name);
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const curves = json.Curves ?? [];
    let fileSegments = 0;
    let filePoints = 0;

    for (const curve of curves) {
      const result = readSegmentCurve(curve.Segments, name, curve.Id);
      fileSegments += result.segmentCount;
      filePoints += result.pointCount;
      if (result.finalTime > Number(json.Meta.Duration) + 1e-6) {
        throw new Error(
          `${name}: ${curve.Id}: Final keyframe ${result.finalTime}s exceeds Duration ${json.Meta.Duration}s.`,
        );
      }
    }

    if (Number(json.Meta.CurveCount) !== curves.length) {
      throw new Error(
        `${name}: CurveCount=${json.Meta.CurveCount}, actual=${curves.length}.`,
      );
    }
    if (Number(json.Meta.TotalSegmentCount) !== fileSegments) {
      throw new Error(
        `${name}: TotalSegmentCount=${json.Meta.TotalSegmentCount}, actual=${fileSegments}.`,
      );
    }
    if (Number(json.Meta.TotalPointCount) !== filePoints) {
      throw new Error(
        `${name}: TotalPointCount=${json.Meta.TotalPointCount}, actual=${filePoints}.`,
      );
    }

    totalCurves += curves.length;
    totalSegments += fileSegments;
    totalPoints += filePoints;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

console.log(
  `\nChecked ${files.length} files, ${totalCurves} curves, ${totalSegments} segments, ${totalPoints} points.`,
);

if (failures > 0) {
  console.error(`${failures} motion file(s) failed validation.`);
  process.exit(1);
}

console.log("All Motion3 files passed structural validation.");
