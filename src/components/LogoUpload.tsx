"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { convertToPng } from "@/lib/logoUtils";
import { toast } from "sonner";

interface LogoUploadProps {
  value: string | null;
  onChange: (pngDataUrl: string | null) => void;
}

const LogoUpload = ({ value, onChange }: LogoUploadProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem válido.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5MB.");
      return;
    }

    setLoading(true);
    try {
      const pngDataUrl = await convertToPng(file);
      onChange(pngDataUrl);
      toast.success("Logo convertida para PNG com sucesso!");
    } catch {
      toast.error("Erro ao processar a imagem.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {value ? (
        <div className="relative group">
          <img
            src={value}
            alt="Logo"
            className="h-12 w-12 rounded-lg object-contain border border-border bg-white cursor-pointer"
            onClick={() => fileRef.current?.click()}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="h-12 w-12 rounded-lg border-2 border-dashed border-border bg-secondary/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
        >
          {loading ? (
            <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
        </button>
      )}

      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="text-xs font-medium text-primary hover:underline"
        >
          {value ? "Trocar logo" : "Inserir sua logomarca (Opcional)"}
        </button>
      </div>
    </div>
  );
};

export default LogoUpload;