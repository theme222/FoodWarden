import { render } from "pele";

const [inputPath, outputPath] = Bun.argv.slice(2);

if (!inputPath?.endsWith(".mmd") || !outputPath?.endsWith(".svg")) {
  console.error("Usage: bun run render <source.mmd> <output.svg>");
  process.exitCode = 1;
} else {
  try {
    const source = await Bun.file(inputPath).text();
    const { svg } = render(source);
    // Keep the canvas transparent. A white outline around dark connectors and
    // arrowheads preserves contrast on both light and dark preview backgrounds.
    const contrast = `<defs><filter id="foodwarden-edge-outline" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="0.9" result="outline"/><feFlood flood-color="#fff"/><feComposite in2="outline" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><style>.pele-edges,.pele-lifelines{filter:url(#foodwarden-edge-outline)}.pele-edges{stroke-width:1.75}</style>`;
    // Resolve Pele's default theme into literal values for SVG viewers that
    // cannot evaluate CSS custom properties (including common rasterizers).
    const themedSvg = svg.replace(/var\(--[\w-]+,([^()]+)\)/g, "$1");
    const variables = new Map(
      [...themedSvg.matchAll(/(--_[\w-]+):([^;"}]+)/g)].map(
        ([, name, value]) => [name!, value!] as const,
      ),
    );
    const portableSvg = themedSvg.replace(
      /var\((--_[\w-]+)\)/g,
      (_, name: string) => {
        const value = variables.get(name);
        if (value === undefined)
          throw new Error(`Unresolved SVG theme variable: ${name}`);
        return value;
      },
    );
    const standaloneSvg = portableSvg.replace(
      /(<svg\b[^>]*>)/,
      `$1${contrast}`,
    );
    await Bun.write(outputPath, standaloneSvg);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
