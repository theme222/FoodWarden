import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const readings = [
  { label: "10:00", temperature: 3.8, voc: 78 },
  { label: "10:30", temperature: 4.1, voc: 82 },
  { label: "11:00", temperature: 4.9, voc: 95 },
  { label: "11:30", temperature: 6.4, voc: 165 },
  { label: "12:00", temperature: 4.6, voc: 112 },
  { label: "12:30", temperature: 4, voc: 88 },
];
const partialReadings = readings.map((reading, index) =>
  index === 2 || index === 3
    ? { ...reading, temperature: null, voc: null }
    : reading,
);

export default function GallerySensorPlot({
  metric,
  name,
  threshold,
  unit,
  color,
  partial,
}: {
  metric: "temperature" | "voc";
  name: string;
  threshold: number;
  unit: string;
  color: string;
  partial: boolean;
}) {
  return (
    <div className="h-56 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={partial ? partialReadings : readings}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
          <XAxis dataKey="label" />
          <YAxis width={42} />
          <ReferenceLine
            y={threshold}
            stroke="var(--muted-ink)"
            strokeDasharray="4 4"
          />
          <Tooltip />
          <Line
            dataKey={metric}
            name={name}
            unit={` ${unit}`}
            stroke={color}
            strokeWidth={2.5}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
