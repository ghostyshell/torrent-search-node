async function globalTeardown() {
  console.log('Global teardown completed');
  
  // Cleanup any remaining processes
  if (global.__SERVER_PROCESS__) {
    global.__SERVER_PROCESS__.kill('SIGTERM');
    // Give it a moment to cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

module.exports = globalTeardown;
