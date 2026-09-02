export function configureMonacoWorkers(target = globalThis, workers = {}) {
  const registeredWorkers = {
    ...(target.MonacoEnvironment?.__adToolsWorkers || {}),
    ...workers,
  };

  const getWorker = (_, label) => {
    const Worker = registeredWorkers[label === "javascript" ? "typescript" : label] || registeredWorkers.editor;
    return new Worker();
  };
  target.MonacoEnvironment = {
    __adToolsWorkers: registeredWorkers,
    getWorker,
  };
}
