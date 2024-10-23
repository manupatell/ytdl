import Head from "next/head";
import Image from "next/image";
import React, { ChangeEvent, useEffect, useRef, useState } from "react";
import Card from "../../components/Card";
import { VideoUploader, VideoUploadResponse } from "@api.video/video-uploader";
import Status from "../../components/Status";
import { useRouter } from "next/router";

export default function Uploader() {
  const [uploadToken, setUploadToken] = useState<{ token: string } | undefined>(
    undefined,
  );
  const [uploadProgress, setUploadProgress] = useState<number | undefined>(
    undefined,
  );
  const [video, setVideo] = useState<VideoUploadResponse | undefined>(
    undefined,
  );
  const [ready, setReady] = useState<boolean>(false);
  const [playable, setPlayable] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/uploadToken")
      .then((res) => res.json())
      .then((res) => setUploadToken(res));
  }, []);

  const handleSelectFile = async (
    e: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!uploadToken || !uploadToken.token) return;
    const clearState = (): void => {
      setReady(false);
      setPlayable(false);
      setVideo(undefined);
      setUploadProgress(undefined);
    };
    clearState();
    if (!e.target.files || !uploadToken) return;
    const file = e.target.files[0];
    const uploader = new VideoUploader({
      file,
      uploadToken: uploadToken.token,
    });
    uploader.onProgress((e) =>
      setUploadProgress(Math.round((e.uploadedBytes * 100) / e.totalBytes)),
    );
    uploader.onPlayable(() => {
      setPlayable(true);
      setReady(true);
    });
    const video = await uploader.upload();
    setVideo(video);
  };

  const handleNavigate = (): void => {
    if (!video) return;
    router.push(`/videos/${video.videoId}?uploaded=1`);
  };

  return (
    <div className="global-container">
      <Head>
        <title>Video Uploader</title>
        <meta
          name="description"
          content="Generated by create next app & created by api.video"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header>
        <span>api.video uploader</span> 🚀
      </header>

      <main>
        <div className="texts-container">
          <p>
            Hey fellow dev! 👋 <br />
            Welcome to this basic example of video uploader provided by{" "}
            <a
              href="https://api.video"
              target="_blank"
              rel="noopener noreferrer"
            >
              api.video
            </a>{" "}
            and powered by{" "}
            <a
              href="https://nextjs.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel & Next.js
            </a>
            .
          </p>
          <p>
            api.video provides APIs and clients to handle all your video needs.
            <br />
            This app is built with the{" "}
            <a
              href="https://github.com/apivideo/api.video-nodejs-client"
              target="_blank"
              rel="noopener noreferrer"
            >
              api.video Node.js client
            </a>{" "}
            and the{" "}
            <a
              href="https://github.com/apivideo/api.video-typescript-uploader"
              target="_blank"
              rel="noopener noreferrer"
            >
              Typescript uploader
            </a>
            .
          </p>
          <p>
            You can{" "}
            <a
              href="https://github.com/vercel/next.js/tree/canary/examples/with-apivideo-upload"
              target="_blank"
              rel="noopener noreferrer"
            >
              check the source code on GitHub
            </a>
            .
          </p>
          <p>
            Please add a video to upload and let the power of the API do the
            rest 🎩
          </p>
        </div>

        {!uploadProgress ? (
          <>
            <button
              className="upload"
              onClick={() => inputRef.current?.click()}
            >
              Select a file
            </button>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept="mp4"
              onChange={handleSelectFile}
            />
          </>
        ) : (
          <>
            <div className="status-container">
              <Status title="Uploaded" done={uploadProgress >= 100} />
              <span />
              <Status title="Ingested" done={uploadProgress >= 100} />
              <span />
              <Status title="Playable" done={playable} />
            </div>
            <Card
              content="https://ws.api.video/videos/{videoId}/source"
              url="https://docs.api.video/reference/post_videos-videoid-source"
              method="post"
            />
          </>
        )}

        {ready && video && (
          <button className="upload" onClick={handleNavigate}>
            Watch it 🍿
          </button>
        )}
      </main>

      <footer>
        <a
          href="https://vercel.com?utm_source=create-next-app&utm_medium=default-template&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by{" "}
          <span>
            <Image src="/vercel.svg" alt="Vercel Logo" width={72} height={16} />
          </span>
        </a>
        <span>and</span>
        <a href="https://api.video" target="_blank" rel="noopener noreferrer">
          api.video
        </a>
      </footer>
    </div>
  );
}
