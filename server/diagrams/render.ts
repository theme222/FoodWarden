import { render } from "pele";

const [inputPath, outputPath] = Bun.argv.slice(2);

if (!inputPath?.endsWith(".mmd") || !outputPath?.endsWith(".svg")) {
  console.error("Usage: bun run render <source.mmd> <output.svg>");
  process.exitCode = 1;
} else {
  try {
    const source = await Bun.file(inputPath).text();
    const { svg } = render(source);
    await Bun.write(outputPath, svg);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
