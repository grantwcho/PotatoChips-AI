export type SubmissionPaths = {
  artifactsPath: string;
  docsPath: string;
  incomingPath: string;
  rootPath: string;
  sourcePath: string;
};

export interface StorageAdapter {
  ensureSubmissionPaths(submissionId: string): Promise<SubmissionPaths>;
  fileExists(submissionId: string, relativePath: string): Promise<boolean>;
  readJson<T>(submissionId: string, relativePath: string): Promise<T | null>;
  readText(submissionId: string, relativePath: string): Promise<string | null>;
  removeSubmission(submissionId: string): Promise<void>;
  resolveSubmissionAbsolutePath(submissionId: string, relativePath: string): string;
  writeBuffer(
    submissionId: string,
    relativePath: string,
    bytes: Buffer
  ): Promise<string>;
  writeJson(
    submissionId: string,
    relativePath: string,
    value: unknown
  ): Promise<string>;
  writeText(
    submissionId: string,
    relativePath: string,
    value: string
  ): Promise<string>;
}
