import { Dms as dms } from "./lib/LatLonSpherical";
import lls from "./lib/LatLonSpherical";
import { readFileSync } from "fs";

const sierraXnola = new lls(37.41414942, -121.824768425);
const sierra_parag = new lls(37.413523321, -121.820213695);

function convertToDecimalDegrees(angle: string) {
  const x = /^ *(\d+)°? *(\d{1,2})'? *(\d{1,2})"? *$/i.exec(angle);
  if (x == null) {
    throw new Error("Invalid angle");
  }
  return parseInt(x[1]) + parseInt(x[2]) / 60 + parseInt(x[3]) / 3600;
}

function bearingToDegrees(bearing: string) {
  const x = /^ *([NS-])? *(\d+)°? *(\d{1,2})'? *(\d{1,2})"? *([EW])? *$/i.exec(
    bearing
  );
  if (x == null) {
    throw new Error("Invalid bearing");
  }

  let angle = parseInt(x[2]) + parseInt(x[3]) / 60 + parseInt(x[4]) / 3600;
  if (x[5] === "W") {
    if (x[1] === "S") {
      angle += 180;
    } else {
      angle = 360 - angle;
    }
  } else {
    if (x[1] === "S") {
      angle = 180 - angle;
    }
  }

  return angle;
}

function feetToMeters(feet: number) {
  //   return feet / 5280.0 / lls.metresToMiles;
  return feet * 0.3048;
}
function oppositeBearingToDegrees(bearing: string) {
  return (bearingToDegrees(bearing) + 180) % 360;
}

function csvToRecords(file: string) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  const headers = lines[0].split(",");
  type AllowedKeysType = (typeof headers)[number];
  type Row = { [key in AllowedKeysType]: string };

  const records: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split(",");
    if (columns.length > 0) {
      const row = {} as Row;
      for (let j = 0; j < columns.length; j++) {
        row[headers[j]] = columns[j];
      }
      records.push(row);
    }
  }

  return records;
}

type BaseRecord = {
  Memo: string;
  Type: "C" | "L";
  Direction: "TRUE" | "FALSE";
};

type LineRecord = BaseRecord & {
  Bearing: string;
  Distance: number;
};

function pointOnLine<T extends LineRecord>(startingPoint: lls, record: T): lls {
  if (record.Direction === "TRUE") {
    return startingPoint.destinationPoint(
      feetToMeters(record.Distance),
      bearingToDegrees(record.Bearing)
    );
  } else if (record.Direction === "FALSE") {
    return startingPoint.destinationPoint(
      feetToMeters(record.Distance),
      oppositeBearingToDegrees(record.Bearing)
    );
  } else {
    throw new Error("Unknown direction");
  }
}

type ArcRecord = BaseRecord & {
  Distance: number;
  Radius: number;
  Delta: string;
};

function pointOnArc<T extends ArcRecord>(
  previousPoint: lls,
  startingPoint: lls,
  record: T
) {
  let delta: number;
  if (record.Delta === "?") {
    delta = (record.Distance * 360.0) / (record.Radius * 2 * Math.PI);
  } else {
    delta = convertToDecimalDegrees(record.Delta);
  }

  let centerBearing = previousPoint.finalBearingTo(startingPoint);
  if (record.Direction === "TRUE") {
    centerBearing += 90;
  } else if (record.Direction === "FALSE") {
    centerBearing -= 90;
  } else {
    throw new Error("Unknown direction");
  }

  const centerPoint = startingPoint.destinationPoint(
    feetToMeters(record.Radius),
    dms.wrap360(centerBearing)
  );

  let radialBearing = startingPoint.finalBearingTo(centerPoint);
  if (record.Direction === "TRUE") {
    radialBearing -= 180 - delta;
  } else if (record.Direction === "FALSE") {
    radialBearing += 180 - delta;
  } else {
    throw new Error("Unknown direction");
  }

  return centerPoint.destinationPoint(
    feetToMeters(record.Radius),
    dms.wrap360(radialBearing)
  );
}

function getDestinationPoints<T extends BaseRecord>(
  startingPoint: lls,
  records: T[]
) {
  const destinationPoints: lls[] = [];
  let previousPoint: lls | undefined;
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as BaseRecord;

    let destinationPoint: lls;
    if (record.Type === "C") {
      destinationPoint = pointOnArc(
        previousPoint,
        startingPoint,
        record as ArcRecord
      );
    } else if (records[i].Type === "L") {
      destinationPoint = pointOnLine(startingPoint, record as LineRecord);
    } else {
      throw new Error("Unknown type");
    }

    destinationPoints.push(destinationPoint);
    previousPoint = startingPoint;
    startingPoint = destinationPoint;
  }

  return destinationPoints;
}

/**
 * Returns a string representing a WKT LINESTRING from the given points.
 *
 * @param   {...LatLonSpherical} points - Points to be used in constructing the WKT LINESTRING.
 * @returns {string} LINESTRING WKT string.
 *
 * @example
 *   const lineString = getLineString(p1, p2, p3); // LINESTRING (0 51, 0.1 51.1, 0.2 51.2)
 */
function getLineString(name: string, desc: string, ...points: lls[]) {
  return `"LINESTRING (${points
    .map((p) => `${p.lon}  ${p.lat}`)
    .join(", ")})", "${name}", "${desc}"`;
}

function getPolygon(name: string, desc: string, ...points: lls[]) {
  return `"POLYGON ((${points
    .map((p) => `${p.lon}  ${p.lat}`)
    .join(", ")}))", "${name}", "${desc}"`;
}

const nolaSouthRecords = csvToRecords("data/nolaSouth.csv") as BaseRecord[];
const nolaSouth = getDestinationPoints(sierraXnola, nolaSouthRecords);

let c3Index,
  l36Index: number | undefined = undefined;
for (let i = 0; i < nolaSouth.length; i++) {
  const record = nolaSouthRecords[i];
  const memo = record.Type + record[Object.keys(record)[0]];
  if (memo === "C3") {
    c3Index = i;
  } else if (memo === "L36") {
    l36Index = i;
  }
}

if (c3Index === undefined || l36Index === undefined) {
  throw new Error("Could not find C3 or L36");
}

const c3Record = nolaSouthRecords[c3Index] as ArcRecord;
const l36Record = nolaSouthRecords[l36Index] as LineRecord;
const c3destination = nolaSouth[c3Index];
const l36destination = nolaSouth[l36Index];

const sierraOffset = 100 + 30;
const c3destBuildPoint = c3destination.destinationPoint(
  feetToMeters(sierraOffset),
  dms.wrap360(bearingToDegrees(l36Record.Bearing) - 90)
);

const l36destBuildPoint = l36destination.destinationPoint(
  feetToMeters(sierraOffset),
  dms.wrap360(c3destination.finalBearingTo(l36destination) - 90)
);

console.log(
  `"POINT (${c3destBuildPoint.lon}  ${c3destBuildPoint.lat})", "bp1", "BP1"`
);
console.log(
  `"POINT (${l36destBuildPoint.lon}  ${l36destBuildPoint.lat})", "bp2", "BP2"`
);

const buildingRecords = csvToRecords("data/building.csv") as BaseRecord[];

const buildingPoints = getDestinationPoints(c3destBuildPoint, buildingRecords);

// remove the last of the building points because it's supposed to be the same as
// the first one and we just wanted it for validation. But the math if off so for
// now we remove it and see later if we need to put in more effort.
// we could also remove the calculation by removing the last line from the records
// file but really at some point we want to make sure that the math is correct.
console.log(
  getPolygon(
    "building",
    "starting at end of C3",
    c3destBuildPoint,
    ...buildingPoints.slice(0, -1),
    c3destBuildPoint
  )
);

// const nolaNorth = getDestinationPoints(
//   sierraXnola,
//   csvToRecords("data/nolaNorth.csv") as BaseRecord[]
// );

// const polygon = [
//   sierraXnola,
//   ...nolaSouth,
//   ...nolaNorth.reverse(),
//   sierraXnola,
// ];

// console.log(
//   `"POLYGON ((${polygon
//     .map((p) => `${p.lon}  ${p.lat}`)
//     .join(", ")}))", "4225sierra",`
// );

// console.log("====");
// let currentPoint = sierra_nola;
// console.log("starting point", currentPoint);

// process.stdout.write(`${currentPoint.lon}  ${currentPoint.lat}, `);
// for (let i = 0; i < records.length; i++) {
//   currentPoint = generatePoint(currentPoint, records[i]);
//   //   console.log(records[i], " => ", currentPoint);
//   process.stdout.write(`${currentPoint.lon}  ${currentPoint.lat}, `);
// }

// process.stdout.write(`${sierra_nola.lon}  ${sierra_nola.lat}!!`);
// console.log("====");

// currentPoint = sierra_parag;
// console.log("starting point", currentPoint);

// process.stdout.write(`${currentPoint.lon}  ${currentPoint.lat}, `);
// for (let i = records.length - 1; i >= 0; i--) {
//   const r = { ...records[i] };
//   r.iBearing = r.fBearing;
//   r.fBearing = records[i].iBearing;
//   currentPoint = generatePoint(currentPoint, r);
//   process.stdout.write(`${currentPoint.lon}  ${currentPoint.lat}, `);
// }
// process.stdout.write(`${sierra_parag.lon}  ${sierra_parag.lat}!!`);
