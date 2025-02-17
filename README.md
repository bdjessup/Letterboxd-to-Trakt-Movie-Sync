# Letterboxd to Trakt Sync

A web application that helps you sync your Letterboxd movie history and ratings to Trakt.tv.

## Features

- Import Letterboxd CSV export
- Sync watched dates and ratings to Trakt
- Live status updates for each movie
- Converts Letterboxd's 1-5 rating scale to Trakt's 1-10 scale
- Beautiful and responsive UI

## Setup

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a Trakt.tv API application:

   - Go to <https://trakt.tv/oauth/applications>
   - Create a new application
   - Set the redirect URI to `http://localhost:3000/api/trakt/auth`
   - Copy the Client ID and Client Secret

4. Create a `.env.local` file in the root directory with the following variables:

   ```
   NEXT_PUBLIC_TRAKT_CLIENT_ID=your_client_id_here
   NEXT_PUBLIC_TRAKT_REDIRECT_URI=http://localhost:3000/api/trakt/auth
   TRAKT_CLIENT_SECRET=your_client_secret_here
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open <http://localhost:3000> in your browser

## Usage

1. Export your Letterboxd data:

   - Go to your Letterboxd Settings
   - Click on "Import & Export"
   - Click "Export Your Data"
   - Download and unzip the file

2. On the web app:
   - Upload your Letterboxd CSV file
   - Authorize with Trakt.tv
   - Click "Sync to Trakt" to start the sync process
   - Monitor the progress in the table

## Development

This project uses:

- Next.js 14 with App Router
- TypeScript
- Tailwind CSS
- TanStack Table
- Trakt API

## License

MIT
