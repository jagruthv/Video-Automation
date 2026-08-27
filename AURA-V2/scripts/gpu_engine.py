import modal

app = modal.App("titanium-vision-engine")

# 1. Optimized Image for AnimateDiff-Lightning (SD1.5)
image = modal.Image.debian_slim(python_version="3.10").pip_install(
    "fastapi[standard]", "torch", "diffusers", "transformers", "accelerate", "imageio[ffmpeg]", "safetensors"
)

with image.imports():
    import torch
    from diffusers import AnimateDiffPipeline, MotionAdapter, EulerDiscreteScheduler
    from diffusers.utils import export_to_video
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    import base64
    import io

# 3. The High-Velocity Lightning Engine
@app.cls(image=image, gpu="T4")
class VideoEngine:
    
    @modal.enter()
    def load_model(self):
        print("[GPU-SERVER] ⚡ Igniting AnimateDiff-Lightning (4-step)...")
        device = "cuda"
        dtype = torch.float16
        
        # Load Motion Adapter (Lightning)
        adapter = MotionAdapter().to(device, dtype)
        ckpt = hf_hub_download("ByteDance/AnimateDiff-Lightning", "animatediff_lightning_4step_diffusers.safetensors")
        adapter.load_state_dict(load_file(ckpt, device=device))
        
        # Load Base Model (epiCRealism for high fidelity)
        self.pipe = AnimateDiffPipeline.from_pretrained(
            "emilianJR/epiCRealism", 
            motion_adapter=adapter, 
            torch_dtype=dtype
        ).to(device)
        
        # Configure Scheduler for Lightning
        self.pipe.scheduler = EulerDiscreteScheduler.from_config(
            self.pipe.scheduler.config, 
            timestep_spacing="trailing", 
            beta_schedule="linear"
        )
        
        # Memory optimizations for T4
        self.pipe.enable_model_cpu_offload()
        print("[GPU-SERVER] 🚀 Lightning Engine Ready (15s renders).")

    @modal.fastapi_endpoint(method="POST")
    def generate(self, data: dict):
        prompt = data.get("prompt", "A high speed chase in cyberpunk city")
        print(f"[GPU-SERVER] ⚡ Rendering Lightning Motion for: '{prompt}'")

        # CFG is kept at 1.0 - 1.5 for Lightning models
        # Hardened Negative Prompt for cinematic realism
        negative_prompt = "low quality, bad art, distorted, blurry, text, watermark, animation, cartoon, cg, multiple heads, multiple limbs, glitchy"
        
        video_frames = self.pipe(
            prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=4,
            guidance_scale=1.2, # Slight boost for prompt adherence
            num_frames=16
        ).frames[0]

        out_path = "/tmp/lightning_clip.mp4"
        export_to_video(video_frames, out_path, fps=8)

        with open(out_path, "rb") as f:
            video_b64 = base64.b64encode(f.read()).decode("utf-8")

        return {
            "status": "success",
            "provider": "modal_lightning",
            "video_base64": video_b64
        }