# Assertion Creator

Generate structural Postman or Axios assertions from a JSON API response. The web app and CLI use the same generator, so an assertion reviewed in the browser can also be produced in scripts and CI jobs.

## Requirements

- Node.js 18 or newer
- npm, included with Node.js

The project has no third-party runtime dependencies. All input is processed locally; the app does not upload response data anywhere.

## Quick start

1. Download or clone this repository.
2. Open a terminal in the repository directory.
3. Start the web app:

```sh
npm start
```

Open <http://localhost:3000> in a browser. On Windows, [`start.bat`](start.bat) also checks whether the server is already running, starts it in a separate terminal, and opens the page. On macOS or Linux, use `sh start.sh` or run `npm start` directly.

Paste a JSON response, enter its HTTP status, and choose `Postman` or `Axios · expect` as the assertion target. Select **Fetch structure** to inspect inferred paths, data types, nullability, and value rules. Adjust the schema before generating the script, then use **Copy** to copy the result.

The web interface supports exact, one-of, comparison, string boundary, containment, and regular-expression rules. It can also extract direct or array values into Postman Environment, Collection, or Global variables for later requests.

## CLI

Generate a Postman script from a file:

```sh
node src/cli.js --input response.json --status 200 --target postman
```

Generate Axios assertions and write them to a file:

```sh
node src/cli.js --input response.json --status 201 --target axios --output assertions.js
```

For inline JSON, use the quoting form for your shell:

```sh
# macOS/Linux
node src/cli.js --json '{"id":123,"status":"ok"}' --status 200 --target postman
```

```powershell
# Windows PowerShell
node src/cli.js --json '{\"id\":123,\"status\":\"ok\"}' --status 200 --target postman
```

To avoid shell quoting differences, use a JSON file with `--input`. To read from standard input, use `cat response.json | node src/cli.js --input -` on macOS/Linux or `Get-Content -Raw response.json | node src/cli.js --input -` in Windows PowerShell.

The generator is also available as `generateAssertions` from `src/generator.js`. The optional `loadTrainingData` helper is exported from `src/training-data.js` for consumers who maintain their own local response/assertion pairs.

## Tests

Run the synthetic unit tests with:

```sh
npm test
```

Private company response fixtures are not part of this repository. Tests use small public examples or temporary files created during the test run.

## Project structure

```text
src/
	cli.js             Command-line interface
	generator.js       Schema inference and assertion generation
	server.js          Dependency-free static web server
	training-data.js   Optional local fixture loader
web/
	app.js             Browser interface
	index.html         Page structure
	styles.css         Responsive styling
test/                Synthetic unit tests
```

## License

This project is available under the [MIT License](LICENSE).