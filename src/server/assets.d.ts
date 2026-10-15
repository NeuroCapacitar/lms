/** Fontes importadas como data URI (`?inline`) e empacotadas no Worker (M7-02). */
declare module '*.woff2?inline' {
  const dataUri: string;
  export default dataUri;
}
