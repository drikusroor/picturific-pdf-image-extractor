# Picturific

A web application for extracting images from PDF files, built with React, TypeScript, and Vite.

## Features

- Upload PDF files and extract embedded images
- Fast, modern UI with Tailwind CSS
- Uses a web worker for PDF processing

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (for running scripts)
- [Node.js](https://nodejs.org/) (if not using Bun for everything)

### Installation

```sh
bun install
```

### Development

```sh
bun run dev
```

### Build

```sh
bun run build
```

### Post-Build Step

After building, a postbuild script automatically copies the required `pdf.worker.min.mjs` file from `pdfjs-dist` into the `dist/` directory. This ensures the PDF extraction works in production builds without manual steps.

### Preview

```sh
bun run preview
```

## Project Structure

- `src/` — Main source code (React, TypeScript)
- `public/` — Static assets (including `pdf.worker.min.mjs`)
- `index.html` — Main HTML entry point
- `tailwind.config.ts` — Tailwind CSS configuration
- `vite.config.ts` — Vite configuration

## License

MIT
