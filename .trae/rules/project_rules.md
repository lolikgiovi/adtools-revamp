## About the Project

AD Tools is a collection of tools to help Application Designers doing their jobs.

## Platform

AD Tools is designed to be a Web Application and Desktop Application (Developed using Tauri for macOS only).

## Development

- When developing the Web Application, we use Vanilla Javascript with Vite. Testing should be using `npm run dev` to start the development server. Listen for the existing running server (port 5173) before running this command. If there is an existing port running Vite Development Server or being triggered by Tauri, do not restart and do preview immediately using the existing port.
- When developing the Desktop Application, we use Tauri with Rust. Testing should be using `npx tauri dev` to start the development server. Check for the existing running server before running this command. The port will also use 5173.
