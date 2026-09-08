"""
Turnkey training script for Model 2: Custom Domain Classifier.

Trains a lightweight domain-specific vision classifier on confirmed
photos of chemical test vials (e.g. positive, negative, inconclusive).
Saves the trained model weights to models/custom_classifier.pt, which the
FastAPI service and evaluate.py will automatically detect and load alongside
SigLIP to form the dual-model ensemble.

Usage:
    python train_custom_model.py --data-dir data/ --epochs 15 --out models/custom_classifier.pt
"""
import argparse
import os
import sys
import time
from pathlib import Path
from PIL import Image

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, Dataset
except ImportError:
    print("PyTorch is required to train Model 2. Install via 'pip install torch'.")
    sys.exit(1)

# Ensure same category definitions as classifier.py
CATEGORIES = ["positive", "negative", "inconclusive"]
LABEL_TO_IDX = {cat: idx for idx, cat in enumerate(CATEGORIES)}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


class CustomVialClassifier(nn.Module):
    """
    Lightweight, high-accuracy CNN architecture designed specifically for
    vial liquid and colorimetric reaction classification. Fast on CPU,
    minimal weights (<5MB), resistant to overfitting on small sample counts.
    """
    def __init__(self, num_classes=3):
        super().__init__()
        self.features = nn.Sequential(
            # Block 1
            nn.Conv2d(3, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2), # 112x112

            # Block 2
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2), # 56x56

            # Block 3
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2), # 28x28

            # Block 4
            nn.Conv2d(128, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((1, 1)), # 1x1
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(128, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(64, num_classes),
        )

    def forward(self, x):
        feat = self.features(x)
        return self.classifier(feat)


def preprocess_image(pil_image: Image.Image, image_size=(224, 224)):
    """Converts a PIL image to a normalized PyTorch tensor (C, H, W)."""
    resized = pil_image.convert("RGB").resize(image_size, Image.Resampling.BILINEAR)
    # Convert to float tensor [0, 1]
    tensor = torch.tensor(list(resized.getdata()), dtype=torch.float32)
    tensor = tensor.view(image_size[1], image_size[0], 3).permute(2, 0, 1) / 255.0
    # Normalize with ImageNet mean and std
    mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
    return (tensor - mean) / std


class VialDataset(Dataset):
    def __init__(self, data_dir: Path):
        self.samples = []
        for cat in CATEGORIES:
            folder = data_dir / cat
            if not folder.is_dir():
                continue
            for p in sorted(folder.iterdir()):
                if p.suffix.lower() in IMAGE_EXTS:
                    self.samples.append((p, LABEL_TO_IDX[cat]))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        with Image.open(path) as img:
            tensor = preprocess_image(img)
        return tensor, label


def train(data_dir: str, epochs: int = 15, batch_size: int = 8, lr: float = 1e-3, out_path: str = "models/custom_classifier.pt"):
    data_path = Path(data_dir)
    if not data_path.exists():
        raise FileNotFoundError(f"Data directory '{data_dir}' not found.")

    dataset = VialDataset(data_path)
    if len(dataset) == 0:
        raise ValueError(f"No valid images found in {data_dir}. Expected subdirectories: positive/, negative/, inconclusive/")

    print(f"Loaded {len(dataset)} training images across categories from {data_dir}.")
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Training Model 2 on device: {device}")

    model = CustomVialClassifier(num_classes=len(CATEGORIES)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)

    start_time = time.time()
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        correct = 0
        total = 0

        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * images.size(0)
            preds = outputs.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

        epoch_loss = total_loss / total
        epoch_acc = (correct / total) * 100.0
        print(f"Epoch [{epoch:02d}/{epochs:02d}] - Loss: {epoch_loss:.4f} - Train Acc: {epoch_acc:.1f}%")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "categories": CATEGORIES,
        "arch": "CustomVialClassifier",
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "epochs": epochs,
    }
    torch.save(checkpoint, out_path)
    elapsed = time.time() - start_time
    print(f"Model 2 successfully trained in {elapsed:.1f}s and saved to: {out_path}")
    print("The ML service will automatically detect and load this model as part of the ensemble.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train custom Model 2 domain classifier.")
    parser.add_argument("--data-dir", default="synthetic_data", help="Path to data folder with class subdirectories.")
    parser.add_argument("--epochs", type=int, default=15, help="Number of training epochs (default: 15).")
    parser.add_argument("--batch-size", type=int, default=8, help="Batch size (default: 8).")
    parser.add_argument("--lr", type=float, default=1e-3, help="Learning rate (default: 0.001).")
    parser.add_argument("--out", default="models/custom_classifier.pt", help="Output file path for model weights.")
    args = parser.parse_args()

    train(args.data_dir, epochs=args.epochs, batch_size=args.batch_size, lr=args.lr, out_path=args.out)
