from PIL import Image, ImageOps

def add_border(input_path, output_path, border_ratio=0.2):
    try:
        img = Image.open(input_path)
        # Calculate border size
        border_width = int(img.width * border_ratio)
        border_height = int(img.height * border_ratio)
        
        # Add white border
        img_with_border = ImageOps.expand(img, border=(border_width, border_height), fill='white')
        
        img_with_border.save(output_path)
        print(f"Created {output_path} with size {img_with_border.size}")
        
        # Calculate new physical width ratio
        # Original width (black part) = 1 unit
        # New width = 1 + 2 * border_ratio
        ratio = (img.width + 2 * border_width) / img.width
        print(f"Width Ratio: {ratio}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # Assuming the original file is in public/
    add_border('public/tag25h9-origin.png', 'public/tag-with-border.png', 0.25)
