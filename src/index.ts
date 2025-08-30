import { Dms as dms } from "./lib/LatLonSpherical";
import lls from "./lib/LatLonSpherical";
import { readFileSync } from "fs";

//const sierraXnola = new lls(37.41414942, -121.824768425);
const sierra_parag = new lls(37.413523321, -121.820213695);

function convertToDecimalDegrees(angle: string) {
  const x = /^ *(\d+)°? *(\d{1,2})'? *(\d{1,2})"? *$/i.exec(angle);
  if (x == null) {
    throw new Error("Invalid angle");
  }
  return parseInt(x[1]) + parseInt(x[2]) / 60 + parseInt(x[3]) / 3600;
}

function bearingToDegrees(bearing: string) {
  if (typeof bearing === "number") {
    return bearing;
  }

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
  return feet * 0.3048;
}
function oppositeBearingToDegrees(bearing: string) {
  return (bearingToDegrees(bearing) + 180) % 360;
}

interface Headers {
  [key: string]: string[];
}

function csvToRecords(file: string) {
  const headers: Headers = {};

  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  const records = [];
  for (let line of lines) {
    line = line.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const cells = line.split(",");

    switch (cells[0]) {
      case "H":
        headers[cells[1]] = cells.slice(1);
        break;

      default:
        const type = cells[0];
        if (type in headers) {
          const columns = headers[type];
          const record = { Type: type } as any;
          for (let i = 1; i < columns.length - 1; i++) {
            record[columns[i]] = cells[i];
          }

          const last_index = columns.length - 1;
          if (columns[last_index].endsWith("...")) {
            record[columns[last_index].slice(0, -3)] = cells.slice(last_index);
          } else {
            record[columns[last_index]] = cells[last_index];
          }

          records.push(record);
        } else {
          throw new Error(`Unknown type: ${type}`);
        }
        break;
    }
  }

  return records;
}

type BaseRecord = {
  Type: "C" | "L" | "P" | "F" | "V";
  Memo: string;
};

type PointRecord = BaseRecord & {
  Latitude: number;
  Longitude: number;
};

type LineRecord = BaseRecord & {
  Bearing: string;
  Distance: number;
  Direction: "TRUE" | "FALSE";
};

type FuncRecord = BaseRecord & {
  Name: string;
  Args: string[];
};

type VarRecord = BaseRecord & {
  Name: string;
  Value: string;
};
/**
 * Given a starting point and a line record, returns a point on the line as described by the record.
 * The direction of the line is either "TRUE" (from the starting point towards the bearing) or
 * "FALSE" (away from the starting point, in the opposite direction of the bearing).
 *
 * @param startingPoint - The starting point
 * @param record - The line record
 * @returns The point on the line
 */
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
  Direction: "TRUE" | "FALSE";
  Radius: number;
  Delta: string;
  TurnForCenter: number;
};

function point<T extends PointRecord>(record: T) {
  return new lls(record.Latitude, record.Longitude);
}

function pointOnArc<T extends ArcRecord>(
  previousPoint: lls,
  startingPoint: lls,
  record: T
) {
  let delta = (record.Distance * 360.0) / (record.Radius * 2 * Math.PI);

  let centerBearing =
    previousPoint.finalBearingTo(startingPoint) + Number(record.TurnForCenter);

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

function adjustDegrees(bearing: number | string, degrees: number | string) {
  return dms.wrap360(Number(bearing) + Number(degrees)); // dms.wrap360(bearing + degrees);
}

const exportedFunctions: { [name: string]: (...args: any[]) => any } = {
  bearingToDegrees,
  adjustDegrees,
  clearDestinationPoints,
};

function clearDestinationPoints() {
  destinationPoints.length = 0;
}

const resultsMap: { [name: string]: any } = {};
const destinationPoints: lls[] = [];

function getDestinationPoints<T extends BaseRecord>(records: T[]) {
  let previousPoint: lls | undefined;

  let result: any;

  let startingPoint: lls | undefined;
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as BaseRecord;

    console.log("record", record);
    switch (record.Type) {
      case "P":
        result = point(record as PointRecord);
        break;

      case "C":
        result = pointOnArc(previousPoint, startingPoint, record as ArcRecord);
        break;

      case "L":
        let lineRecord = record as LineRecord;
        for (const value of Object.values(lineRecord)) {
          if (value && typeof value === "string" && value.startsWith("$")) {
            const newRecord: { [key: string]: any } = {};
            for (const key of Object.keys(lineRecord)) {
              const v = lineRecord[key as keyof LineRecord];
              if (v && typeof v === "string" && v.startsWith("$")) {
                newRecord[key] = resultsMap[v.substring(1)];
              } else {
                newRecord[key] = v;
              }
            }

            lineRecord = newRecord as LineRecord;
            break;
          }
        }

        result = pointOnLine(startingPoint, lineRecord);
        break;

      case "F":
        const funcRecord = record as FuncRecord;
        const args =
          funcRecord.Args?.map((arg) => {
            return arg.startsWith("$") ? resultsMap[arg.substring(1)] : arg;
          }) || [];
        result = exportedFunctions[funcRecord.Name].call(null, ...args);
        break;

      case "V":
        resultsMap[(record as VarRecord).Name] = result;
        break;

      default:
        throw new Error(`Unexpected type in the record: ${record}`);
    }

    if (result instanceof lls) {
      destinationPoints.push(result);
      previousPoint = startingPoint;
      startingPoint = result;
    }
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
    .map((p) => `${p.lon} ${p.lat}`)
    .join(",")})", "${name}", "${desc}"`;
}

/**
 * Returns a string representing a WKT POLYGON from the given points.
 *
 * @param   {string}    name - Name of the polygon.
 * @param   {string}    desc - Description of the polygon.
 * @param   {...LatLonSpherical} points - Points to be used in constructing the WKT POLYGON.
 * @returns {string} POLYGON WKT string.
 *
 * @example
 *   const polygon = getPolygon("my-poly", "description", p1, p2, p3, p1); // POLYGON ((0 51, 0.1 51.1, 0.2 51.2, 0 51))
 */
function getPolygon(name: string, desc: string, ...points: lls[]) {
  return `"POLYGON ((${points
    .map((p) => `${p.lon} ${p.lat}`)
    .join(",")}))", "${name}", "${desc}"`;
}

if (process.argv.length <= 2) {
  console.error("Please provide a file name as an argument");
  process.exit(1);
}

const argument = process.argv[2];

let records: BaseRecord[];
try {
  records = csvToRecords(argument) as BaseRecord[];
} catch (e) {
  console.error("Unable to retrieve records", e);
  process.exit(1);
}

getDestinationPoints(records);

console.log(
  getLineString("nolaSouth", "starting at end of C3", ...destinationPoints)
);

// let c3Index,
//   l36Index: number | undefined = undefined;
// for (let i = 0; i < destinationPoints.length; i++) {
//   const record = records[i];
//   const memo = record.Type + record.Memo;
//   if (memo === "C3") {
//     c3Index = i;
//   } else if (memo === "L36") {
//     l36Index = i;
//   }
// }

// if (c3Index === undefined || l36Index === undefined) {
//   throw new Error("Could not find C3 or L36");
// }

// const l36Record = records[l36Index] as LineRecord;
// const c3destination = destinationPoints[c3Index];
// const l36destination = destinationPoints[l36Index];

// const sierraOffset = 100 + 30;
// const c3destBuildPoint = c3destination.destinationPoint(
//   feetToMeters(sierraOffset),
//   dms.wrap360(bearingToDegrees(l36Record.Bearing) - 90)
// );

// const l36destBuildPoint = l36destination.destinationPoint(
//   feetToMeters(sierraOffset),
//   dms.wrap360(c3destination.finalBearingTo(l36destination) - 90)
// );

// console.log(
//   `"POINT (${c3destBuildPoint.lon}  ${c3destBuildPoint.lat})", "bp1", "BP1"`
// );
// console.log(
//   `"POINT (${l36destBuildPoint.lon}  ${l36destBuildPoint.lat})", "bp2", "BP2"`
// );

// const buildingRecords = csvToRecords("data/building.csv") as BaseRecord[];

// const buildingPoints = getDestinationPoints(c3destBuildPoint, buildingRecords);

// remove the last of the building points because it's supposed to be the same as
// the first one and we just wanted it for validation. But the math if off so for
// now we remove it and see later if we need to put in more effort.
// we could also remove the calculation by removing the last line from the records
// file but really at some point we want to make sure that the math is correct.
// console.log(
//   getPolygon(
//     "building",
//     "starting at end of C3",
//     c3destBuildPoint,
//     ...buildingPoints.slice(0, -1),
//     c3destBuildPoint
//   )
// );

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
//     .map((p) => `${p.lon} ${p.lat}`)
//     .join(",")}))", "4225sierra",`
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
