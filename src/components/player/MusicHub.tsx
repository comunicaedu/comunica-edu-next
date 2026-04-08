"use client";

import { useState } from "react";
import { Upload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MusicUpload from "./MusicUpload";
import PlaylistSection from "./PlaylistSection";
import CreatePlaylistModal from "./CreatePlaylistModal";

interface Song {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
}

interface MusicHubProps {
  currentSong: Song | null;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onPlayImported?: (song: Song) => void;
  isYouTubeLoading?: boolean;
  onQueueChange?: (songs: Song[], currentIndex: number, playlistId?: string) => void;
  activePlaylistId?: string | null;
  onMoodActive?: (mood: any) => void;
  repeatPlaylistId?: string | null;
  onToggleRepeatPlaylist?: (playlistId: string) => void;
}

const MusicHub = ({ currentSong, isPlaying, onPlay, onPause, onPlayImported, isYouTubeLoading, onQueueChange, activePlaylistId, onMoodActive, repeatPlaylistId, onToggleRepeatPlaylist }: MusicHubProps) => {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="bg-background pt-1 pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2 flex-wrap min-h-[2.5rem]">
        <Button
          size="sm"
          onClick={() => setUploadOpen(true)}
          className="shrink-0 gap-2 bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary active:scale-95 transition-all w-36"
        >
          <Upload className="h-4 w-4" />
          Enviar Música
        </Button>

        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 gap-2 bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary active:scale-95 transition-all w-36"
        >
          <Plus className="h-4 w-4" />
          Criar
        </Button>
        </div>
      </div>

      {/* Upload Modal */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent hideCloseButton className="sm:max-w-md max-h-[90dvh] overflow-y-auto scrollbar-none">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Upload className="h-5 w-5 text-primary" /> Enviar Música
            </DialogTitle>
          </DialogHeader>
          <MusicUpload onUploadComplete={() => setUploadOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Create Playlist Modal */}
      <CreatePlaylistModal open={createOpen} onOpenChange={setCreateOpen} />

      {/* Playlists */}
      <PlaylistSection
        currentSong={currentSong}
        isPlaying={isPlaying}
        onPlay={onPlay}
        onPause={onPause}
        onPlayImported={onPlayImported}
        isYouTubeLoading={isYouTubeLoading}
        onQueueChange={onQueueChange}
        activePlaylistId={activePlaylistId}
        onMoodActive={onMoodActive}
        repeatPlaylistId={repeatPlaylistId}
        onToggleRepeatPlaylist={onToggleRepeatPlaylist}
      />
    </div>
  );
};

export default MusicHub;