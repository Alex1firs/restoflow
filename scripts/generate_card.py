import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

def create_menu_card():
    # Card dimensions for 300 DPI 4x6 inch card (1200 x 1800 px)
    width = 1200
    height = 1800
    
    # Colors
    bg_color = (18, 18, 18)  # Deep matte obsidian
    text_color = (255, 255, 255)
    logo_red = (220, 38, 38)
    
    # Create canvas
    img = Image.new('RGB', (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)
    
    # 1. Add subtle texture (noise)
    for _ in range(5000):
        x = os.urandom(2)[0] % width
        y = os.urandom(1)[0] % height
        c = os.urandom(1)[0] % 10 + 15
        draw.point((x, y), fill=(c, c, c))
    
    # 2. Add subtle border
    border_w = 4
    draw.rectangle([border_w, border_w, width-border_w, height-border_w], outline=(50, 50, 50), width=1)

    # 3. Logo & Typography (Using system fonts for premium feel)
    try:
        # Mac system font paths
        font_serif = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
        font_sans = "/System/Library/Fonts/Helvetica.ttc"
        
        font_logo = ImageFont.truetype(font_serif, 100)
        font_main = ImageFont.truetype(font_serif, 120)
        font_small = ImageFont.truetype(font_sans, 35)
        font_badge = ImageFont.truetype(font_sans, 25)
    except:
        font_logo = font_main = font_small = font_badge = ImageFont.load_default()

    # LOGO RECREATION (High-fidelity approximation)
    # Arched banner (simplified as a box for now)
    draw.rectangle([width//2 - 200, 100, width//2 + 200, 140], fill=logo_red)
    draw.text((width//2, 120), "FRESH & TASTY", fill=text_color, anchor="mm", font=font_badge)
    
    # Grill Icon placeholder (3 stars)
    draw.text((width//2, 180), "★ ★ ★", fill=logo_red, anchor="mm", font=font_small)
    
    # Main Brand Name
    draw.text((width//2, 300), "GRILLS CAPITOL", fill=logo_red, anchor="mm", font=font_logo)
    draw.line([width//2 - 250, 360, width//2 + 250, 360], fill=text_color, width=2)
    
    # MAIN TEXT: SCAN TO VIEW MENU
    draw.text((width//2, 600), "SCAN TO VIEW MENU", fill=text_color, anchor="mm", font=font_main)
    
    # 4. QR CODE (Centered in a white box)
    qr_data = "https://restoflow.org/r/grills-capitol"
    qr = qrcode.QRCode(version=1, box_size=20, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    
    # Resize QR to fit nicely
    qr_w, qr_h = qr_img.size
    qr_box_size = 600
    qr_img = qr_img.resize((qr_box_size, qr_box_size), Image.NEAREST)
    
    # Paste QR Code
    paste_pos = (width//2 - qr_box_size//2, height//2 - qr_box_size//2 + 100)
    img.paste(qr_img, paste_pos)
    
    # SUBTEXT
    draw.text((width//2, height - 300), "Order directly from your phone", fill=(150, 150, 150), anchor="mm", font=font_small)
    
    # Save PNG
    output_path_png = "/Users/nwabufohalex/Desktop/rest/grills_capitol_menu_card.png"
    img.save(output_path_png)
    
    # Save PDF
    output_path_pdf = "/Users/nwabufohalex/Desktop/rest/grills_capitol_menu_card.pdf"
    img.save(output_path_pdf, "PDF", resolution=300.0)
    
    print(f"Design assets created at {output_path_png} and {output_path_pdf}")

if __name__ == "__main__":
    create_menu_card()
