// Runs the migrations against TEST_DATABASE_URL. Works on Windows, macOS and Linux
// (the inline "NODE_ENV=test node ..." form does not work in PowerShell or cmd).
process.env.NODE_ENV = 'test';
await import('./migrate.js');
