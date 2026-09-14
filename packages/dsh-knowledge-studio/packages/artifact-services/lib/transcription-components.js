/** Recommendations for host-owned, explicit provisioning. No download side effects. */
export function getTranscriptionComponents() {
  return {engine:{id:'whisper-cpp',version:'1.8.3',license:'MIT',source:'https://github.com/ggml-org/whisper.cpp/tree/v1.8.3',
    binaries:[{platform:'win32',arch:'x64',filename:'whisper-bin-x64.zip',bytes:3968674,
      url:'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip',
      sha256:'d824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d'}]},
    models:[{id:'whisper-tiny-q5_1',engine:'whisper-cpp',multilingual:true,filename:'ggml-tiny-q5_1.bin',bytes:32152673,license:'MIT',
      url:'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny-q5_1.bin',
      sha256:'818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7'}]}
}
