// Illustrative sanitary sewer for the Varuna River Ward, modelled in EPA SWMM 5.2.4.
//
// There is no surveyed sewer data for the ward, so this network is designed
// to India's CPHEEO Manual on Sewerage and Sewage Treatment (2013) rules and
// follows the trunk sewer drawn in the 3D district. Every number below is an
// assumption, not a measurement.

// District drawing coordinates are percentages; assume the ward is 600 m × 450 m.
const WARD_M = { x: 600, y: 450 };

// Manholes along the drawn trunk (CityEngine sewerPoints), west to east; the
// last point is the outfall to the river interceptor. Ground falls toward the river.
const MANHOLES = [
  { name: "MH1", x: 7, y: 78, ground: 81.2 },
  { name: "MH2", x: 28, y: 68, ground: 80.9 },
  { name: "MH3", x: 44, y: 52, ground: 80.6 },
  { name: "MH4", x: 63, y: 64, ground: 80.3 },
  { name: "OUT", x: 86, y: 39, ground: 79.8 },
];

// CPHEEO minimum sizes and self-cleansing slopes: 150 mm branches at 1 in 150,
// 200 mm trunk at 1 in 200; 1.2 m cover at the head of the line.
const PIPES = [
  { diameter: 0.15, slope: 1 / 150 },
  { diameter: 0.15, slope: 1 / 150 },
  { diameter: 0.2, slope: 1 / 200 },
  { diameter: 0.2, slope: 1 / 200 },
];
const HEAD_COVER_M = 1.2;

// CPHEEO: 135 L/person/day water supply, 80% returns as sewage, peak factor
// 3.0 below 20,000 people. The hourly pattern averages 1.0 and peaks at 3.0.
const LITRES_PER_PERSON_DAY = 135;
const RETURN_FACTOR = 0.8;
const HOURLY_PATTERN = [0.179, 0.133, 0.133, 0.133, 0.225, 0.595, 1.335, 2.538, 3.0, 2.075, 1.15, 0.873, 0.78, 0.78, 0.688, 0.688, 0.78, 0.965, 1.243, 1.798, 1.705, 1.15, 0.688, 0.364];

// CPHEEO: sewers should run at most 0.8 full depth at peak flow.
const DESIGN_DEPTH_RATIO = 0.8;

export type SewerResults = {
  pipes: Array<{ name: string; peakFlowLps: number; flowRatio: number; depthRatio: number; peakTime: string }>;
  outfallPeakLps: number;
  surchargedManholes: number;
};

export function sewerNetwork(population: number) {
  const length = (a: (typeof MANHOLES)[number], b: (typeof MANHOLES)[number]) => Math.hypot(((a.x - b.x) / 100) * WARD_M.x, ((a.y - b.y) / 100) * WARD_M.y);

  // Inverts follow the pipe slopes from the head manhole down to the outfall.
  const inverts = [MANHOLES[0].ground - HEAD_COVER_M];
  PIPES.forEach((pipe, index) => inverts.push(inverts[index] - pipe.slope * length(MANHOLES[index], MANHOLES[index + 1])));

  // Each upstream manhole serves a quarter of the ward (flows in L/s).
  const averageFlow = (population * LITRES_PER_PERSON_DAY * RETURN_FACTOR) / 86400 / 4;
  const junctions = MANHOLES.slice(0, -1);
  const f = (value: number) => value.toFixed(4);

  return `[TITLE]
MirrorCity illustrative sanitary sewer, Varuna River Ward (CPHEEO design, not surveyed)

[OPTIONS]
FLOW_UNITS           LPS
FLOW_ROUTING         DYNWAVE
START_DATE           01/01/2026
START_TIME           00:00:00
REPORT_START_DATE    01/02/2026
REPORT_START_TIME    00:00:00
END_DATE             01/03/2026
END_TIME             00:00:00
DRY_STEP             00:05:00
WET_STEP             00:05:00
REPORT_STEP          00:15:00
ROUTING_STEP         0:00:10

[JUNCTIONS]
;;Name Elev MaxDepth
${junctions.map((node, index) => `${node.name} ${f(inverts[index])} ${f(node.ground - inverts[index])}`).join("\n")}

[OUTFALLS]
;;Name Elev Type
OUT ${f(inverts[inverts.length - 1])} FREE

[CONDUITS]
;;Name From To Length Roughness InOffset OutOffset
${PIPES.map((_, index) => `P${index + 1} ${MANHOLES[index].name} ${MANHOLES[index + 1].name} ${f(length(MANHOLES[index], MANHOLES[index + 1]))} 0.013 0 0`).join("\n")}

[XSECTIONS]
;;Link Shape Geom1 Geom2 Geom3 Geom4 Barrels
${PIPES.map((pipe, index) => `P${index + 1} CIRCULAR ${pipe.diameter} 0 0 0 1`).join("\n")}

[DWF]
;;Node Constituent Baseline Patterns
${junctions.map((node) => `${node.name} FLOW ${averageFlow.toExponential(6)} "DIURNAL"`).join("\n")}

[PATTERNS]
DIURNAL HOURLY ${HOURLY_PATTERN.join(" ")}

[REPORT]
NODES ALL
LINKS ALL
`;
}

// Reads the SWMM report (the first simulated day is warm-up; the report covers day 2).
export function parseSewerReport(report: string): SewerResults {
  const pipes = [...report.matchAll(/^\s+(P\d+)\s+CONDUIT\s+([\d.]+)\s+\d+\s+(\d\d:\d\d)\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*$/gm)].map(([, name, flow, peakTime, flowRatio, depthRatio]) => ({
    name,
    peakFlowLps: Number(flow),
    flowRatio: Number(flowRatio),
    depthRatio: Number(depthRatio),
    peakTime,
  }));
  const outfall = report.match(/^\s+OUT\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s+[\d.]+\s*$/m);
  const surchargeSection = report.slice(report.indexOf("Node Surcharge Summary"), report.indexOf("Node Flooding Summary"));
  return {
    pipes,
    outfallPeakLps: outfall ? Number(outfall[1]) : NaN,
    surchargedManholes: /No nodes were surcharged/.test(surchargeSection) ? 0 : (surchargeSection.match(/^\s+MH\d+\s+JUNCTION/gm) ?? []).length,
  };
}

export function sewerMetrics(results: SewerResults | null) {
  if (!results) {
    return ["Network load", "Peak outflow", "Pipes over 80%"].map((label) => ({ value: "—", label, trend: "Computing…" }));
  }
  const busiest = results.pipes.reduce((top, pipe) => (pipe.flowRatio > top.flowRatio ? pipe : top));
  const overDesign = results.pipes.filter((pipe) => pipe.depthRatio > DESIGN_DEPTH_RATIO).length;
  return [
    { value: `${Math.round(busiest.flowRatio * 100)}%`, label: "Network load", trend: `busiest pipe ${busiest.name}` },
    { value: `${results.outfallPeakLps.toFixed(1)} L/s`, label: "Peak outflow", trend: `at ${results.pipes[results.pipes.length - 1].peakTime}` },
    { value: String(overDesign), label: "Pipes over 80%", trend: results.surchargedManholes ? `${results.surchargedManholes} manholes surcharged` : overDesign ? "Above design depth" : "All within design depth" },
  ];
}
