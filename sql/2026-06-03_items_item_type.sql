-- Add an editable item type used by SKU Edit UI.
-- This does not affect stock, transfers, POS, queues, or integration logic.

alter table public.items
add column if not exists item_type text;

update public.items
set item_type = case
  when reporting_category in ('Shoes', 'Boots', 'Trainers') then 'Footwear'
  when reporting_category in (
    'Accessories',
    'Bag',
    'Beanie',
    'Belt',
    'Cap',
    'Hat',
    'Jewellery',
    'Scarf',
    'Sunglasses',
    'Tie'
  ) then 'Accessories'
  when reporting_category in (
    'Blazer',
    'Boiler Suit',
    'Cardigan',
    'Cargo Trousers',
    'Coat',
    'Dress',
    'Dungarees',
    'Fleece',
    'Football Shirt',
    'Hoodie',
    'Jacket',
    'Jeans',
    'Jersey',
    'Jorts',
    'Knitwear',
    'Long Sleeve T-Shirt',
    'Military',
    'Outdoor',
    'Overalls',
    'Polo Shirt',
    'Pyjama Bottoms',
    'Pyjama Shirt',
    'Rugby Shirt',
    'Shirt',
    'Shorts',
    'Skirt',
    'Suiting',
    'Sweatshirt',
    'Swimwear',
    'T-Shirt',
    'Tank Top',
    'Tracksuit Bottoms',
    'Trousers',
    'Vest',
    'Waistcoat',
    'Workwear Jacket'
  ) then 'Clothing'
  else 'Other'
end
where nullif(trim(coalesce(item_type, '')), '') is null;
