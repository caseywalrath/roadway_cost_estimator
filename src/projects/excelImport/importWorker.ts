import { readWorkbook, toWorkbookReadError } from "./readWorkbook";
import type {
  ExcelImportWorkerRequest,
  ExcelImportWorkerResponse,
  ExcelImportWorkerSuccessResponse
} from "./types";

/**
 * Dedicated worker entry point. The UI owns the worker lifecycle and can
 * terminate it when a user cancels or the operation exceeds its wall-clock
 * budget. Requests carry ArrayBuffers so no File or DOM object crosses the
 * worker boundary.
 */
interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<ExcelImportWorkerRequest>) => void): void;
  postMessage(response: ExcelImportWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;
const cancellations = new Map<string, AbortController>();

workerScope.addEventListener("message", (event: MessageEvent<ExcelImportWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: ExcelImportWorkerRequest): Promise<void> {
  if (request.type === "cancel") {
    cancellations.get(request.requestId)?.abort();
    return;
  }

  const controller = new AbortController();
  cancellations.set(request.requestId, controller);
  try {
    const workbook = readWorkbook(request.data, {
      fileName: request.fileName,
      limits: request.limits,
      signal: controller.signal,
      onProgress: (progress) => {
        post({ type: "progress", requestId: request.requestId, progress });
      }
    });
    const response: ExcelImportWorkerSuccessResponse = {
      type: "success",
      requestId: request.requestId,
      workbook
    };
    post(response);
  } catch (error) {
    post({ type: "error", requestId: request.requestId, error: toWorkbookReadError(error) });
  } finally {
    cancellations.delete(request.requestId);
  }
}

function post(response: ExcelImportWorkerResponse): void {
  workerScope.postMessage(response);
}
