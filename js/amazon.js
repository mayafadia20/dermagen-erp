// Dépenses Amazon 2024–2026 (document « Dépenses totales Amazon ») : import en un clic dans le module Factures.
// Une facture Amazon par numéro de facture, ses articles en lignes, et un paiement (carte de crédit) à la date
// de la facture puisque les commandes Amazon sont réglées à l'achat.
import { db } from './store.js';
import { toast, confirmDialog } from './ui.js';

export const AMAZON_TAG = 'amazon-2024-2026';
const SUPPLIER_NAME = 'Amazon.ca';

const CAT = {
  B: 'Produits de référence (benchmark)',
  A: 'Appareils et accessoires capillaires',
  M: 'Matières premières / ingrédients',
  L: 'Équipement de laboratoire',
  G: 'Fournitures générales',
};

// [date, n° facture, n° commande, vendeur, article, ASIN, qté, prix unitaire, TPS, TVQ, catégorie, remise unitaire]
const ROWS = [
  ['2024-01-06', 'CA42WV0T3I', '701-9465245-8255446', 'Adriano de Mendonca Costa', 'Lana Brasiles – Forest Tanino Kit (2 × 1 L)', 'B09RTMVH9G', 1, 299.00, 0, 0, 'B'],
  ['2024-02-03', 'CA41AEQ9GM6I', '701-9452661-9756224', 'Yves Rocher North America Inc.', 'Yves Rocher Gift set Monoi Lover 4 pièces (huile corps et cheveux 125 ml…)', 'B0BHCNLHZG', 1, 29.95, 1.50, 2.99, 'B'],
  ['2024-02-03', 'CA428IJ3E2MI', '701-9452661-9756224', 'shen zhen shi zhi ku wei lai ke ji you xian gong', 'Yiclick Heatless Hair Curler (bigoudi sans chaleur)', 'B0BBG5G8VZ', 1, 14.99, 0.75, 1.49, 'A'],
  ['2024-02-03', 'CA442XLPDAEI', '701-9452661-9756224', 'Maple Holistics LLC', 'Pure Evening Primrose Oil (huile d’onagre pressée à froid)', 'B012GPMKD6', 1, 14.39, 0.72, 1.43, 'M'],
  ['2024-02-03', 'CA4JVH4PWKI', '701-9452661-9756224', 'shenzhenshinuodunwangluokejiyouxiangongsi', 'MZQSIY Satin Sleep Cap (bonnet de nuit en satin)', 'B09WYKFRCH', 1, 7.89, 0.39, 0.79, 'A'],
  ['2024-02-03', 'CA4ZVED69EI', '701-9452661-9756224', 'shenzhenshifengweimakejiyouxiangongsi', 'Aofmee Bath Bombs, 7 pcs Spa Kit', 'B07D6GM758', 1, 19.99, 1.00, 1.99, 'B'],
  ['2024-02-09', 'CA45C189MAUI', '701-3307329-4252202', 'Cocosan Resources Inc.', '[FOOD A HOLIC] Aloe Vera Purity 99 % Soothing Gel 300 ml', 'B00TNB08HC', 1, 11.45, 0.57, 1.14, 'B'],
  ['2024-03-04', 'CA4NTBH7IXI', '701-9103906-2563436', 'IRONVE LLC', 'Estée Lauder Advanced Night Repair Serum 1 oz', 'B08DH979F7', 1, 100.88, 5.05, 10.06, 'B'],
  ['2024-03-28', 'CA42R88QJ3EI', '701-6763818-4165007', 'KANZY LTD', 'Kanzy Jojoba Oil Organic Cold Pressed 120 ml', 'B07BYPW7LZ', 1, 14.99, 0.75, 1.49, 'M'],
  ['2024-03-28', 'CA44S4GUVZOI', '701-6763818-4165007', 'SUNIL SAMPATRAJ JAIN', 'Neutral Henna powder (Cassia Obovata) mi nature 227 g', 'B08GCM5PGT', 1, 18.99, 0, 1.89, 'M'],
  ['2024-03-28', 'CA4IUF7T41QI', '701-6763818-4165007', '1000109900 Ontario Inc.', 'Plant of Life Rosemary & Mint Oil – Hair Strengthening Complex', 'B0BN94J74Z', 1, 19.95, 1.00, 1.99, 'B'],
  ['2024-04-03', 'CA4LTXCWACCUI', '701-8307549-5533061', 'Amazon.com.ca ULC', 'Viviscal Gorgeous Growth Densifying Elixir 50 ml', 'B01B81JSQG', 1, 27.19, 1.36, 2.71, 'B'],
  ['2024-05-04', 'CA41EKDFTT40I', '701-0726685-2862641', 'VOLANS UPTOWN LLC', 'Botanic Hearth Tea Tree Body Wash', 'B07HHHMJ6V', 1, 20.99, 1.05, 2.09, 'B'],
  ['2024-05-04', 'CA45WIJY3JQI', '701-0726685-2862641', 'Guangshao Lin', 'GM Gumili Rosemary Essential Oil 100 ml', 'B0BW4PKFSB', 1, 14.99, 0.75, 1.49, 'M'],
  ['2024-06-26', 'CA41F9JKBACCUI', '701-6873592-6986602', 'Amazon.com.ca ULC', 'K18 Leave-In Molecular Repair Hair Mask', 'B0961ZS96M', 1, 101.50, 5.08, 10.12, 'B'],
  ['2024-07-26', 'CA4JDNOTJEI', '701-1682454-8221853', 'Nexxus Capital Fund I LLC', 'Pure Shilajit Resin with Spoon (1 oz)', 'B088VRQK2Z', 1, 61.99, 3.10, 0, 'B'],
  ['2024-08-15', 'CA41Y4236ACCUI', '701-8947345-4645042', 'Amazon.com.ca ULC', 'Tulip Soda Ash 1 lb, 2-Pack', 'B07PKF83ZW', 1, 15.85, 0.79, 1.58, 'M'],
  ['2024-08-15', 'CA49G8JY3JQI', '701-8947345-4645042', 'Guangshao Lin', 'GM Gumili Rosemary Essential Oil 100 ml', 'B0BW4PKFSB', 1, 14.99, 0.75, 1.49, 'M'],
  ['2024-08-26', 'CA421RQ16ACCUI', '701-4937946-2208249', 'Amazon.com.ca ULC', 'LANEIGE Radian-C Cream (vitamines C & E)', 'B09P242FY1', 1, 47.50, 2.37, 4.74, 'B'],
  ['2024-08-26', 'CA454VFM4UWI', '701-4937946-2208249', 'Tatcha LLC', 'TATCHA The Water Cream', 'B072NNC2LR', 1, 97.00, 4.85, 9.68, 'B'],
  ['2024-09-22', 'CA42BN1PFACCUI', '701-3998306-4542637', 'Amazon.com.ca ULC', 'L’Oréal Paris Men Expert Sculpting Paste', 'B01AXYAGCE', 1, 6.99, 0.35, 0.70, 'B'],
  ['2024-09-22', 'CA42BN1PFACCUI', '701-3998306-4542637', 'Amazon.com.ca ULC', 'Conair Scalp Massaging Brush', 'B0CQ3NP1F9', 1, 5.97, 0.30, 0.59, 'A'],
  ['2024-10-27', 'CA41XRI483SI', '701-3358332-9528221', 'Ma Chenxi', 'Klvied Reinforced Wig Mannequin Stand with Head, 22 in', 'B0C8MVCVJ4', 1, 48.59, 2.43, 4.85, 'A'],
  ['2024-10-27', 'CA422KBYFN4I', '701-3358332-9528221', 'zhangsaisai', '10 in Headband Wig Human Hair (perruque cheveux naturels)', 'B0CXHPRJNB', 1, 53.99, 2.70, 5.39, 'A'],
  ['2024-10-27', 'CA4FM2AE99I', '701-6209013-1012223', 'GAOZHOUSHIHENGYONGRUIDIANZISHANGWUZHONGXIN', 'Ultrasonic Infrared Hair Care Iron, LCD Display', 'B07DR77W87', 1, 84.76, 4.24, 8.45, 'A'],
  ['2024-10-27', 'CA4FM2AE99I', '701-6209013-1012223', 'GAOZHOUSHIHENGYONGRUIDIANZISHANGWUZHONGXIN', 'Frais de livraison', '', 1, 9.00, 0.45, 0.90, 'A'],
  ['2025-03-14', 'CA51M7FYG8KI', '701-0653359-2749035', 'DESTDEMG INC', 'Faszin Hair Straighteners, Titanium Flat Iron 2-in-1 3D', 'B0C5J6P2RT', 1, 98.98, 4.95, 9.87, 'A'],
  ['2025-04-25', 'CA518LEHCNV0I', '701-3919612-4815424', 'Noeast Foods Ltd.', 'Gelatin Powder, Beef Grass Fed, Elo’s Premium', 'B0DSWP5SYJ', 1, 16.95, 0.85, 0, 'M'],
  ['2025-04-25', 'CA5GSOY82JI', '701-3919612-4815424', 'Unielle Inc.', 'Lancôme Nutrix Royal Body Intense Restoring Lotion 400 ml', 'B002UZVZP2', 1, 55.08, 2.75, 5.50, 'B'],
  ['2025-05-20', 'CA5P01L9HB8I', '701-1486206-2564256', 'zhuhailiduandianzishangwuyouxiangongsi', 'Wavytalk Thermal Brush 1 1/2 in (brosse soufflante)', 'B0D8Q3548V', 1, 69.99, 3.50, 6.98, 'A'],
  ['2025-09-03', 'CA5TLALOQ0I', '701-1241800-1441856', 'DongGuanShiTianXiLinShangMaoYouXianGongSi', 'MacBook Air Charger Replacement 45 W T-Tip', 'B0D14CY8QF', 1, 21.99, 1.10, 2.19, 'L'],
  ['2025-09-27', 'CA53QVOGP7GI', '701-6230410-2058635', 'hBARSCI LLC', 'Eisco Labs 25 ml Pipet Pipette Rubber Bulb', 'B00JQMXPAU', 1, 21.05, 0, 0, 'L'],
  ['2025-09-27', 'CA54Z2BBH3I', '701-6230410-2058635', 'Zhengzhou Eastar Instrument Equipment', 'NANBEI Lab Benchtop pH Meter Digital, LCD 6 in', 'B0CJJR577R', 1, 312.55, 0, 0, 'L'],
  ['2025-09-27', 'CA56KP8JRQI', '701-6230410-2058635', 'Pure Ponta LLC', 'Pure Ponta Weigh Boats Medium, 125 pack 100 ml', 'B07M5RMNPF', 1, 27.57, 0, 0, 'L'],
  ['2025-09-27', 'CA591E0HFVMSI', '701-6230410-2058635', 'huizhouchuangyingjungongyinlianguanliyouxiangongsi', 'PATIKIL Graduated Dropper Pipette 15 ml, borosilicate', 'B0BCFLNY2J', 1, 18.90, 0, 0, 'L'],
  ['2025-09-27', 'CA55K4BSG4I', '701-7011879-2363424', 'NANJING UCLA SCIENTIFIC INSTRUMENT', 'UXILAII Analytical Balance 300 g × 0,001 g', 'B0CDM9SXCD', 1, 199.00, 9.95, 19.85, 'L'],
  ['2025-09-27', 'CA591TXHFVMSI', '701-7011879-2363424', 'huizhouchuangyingjungongyinlianguanliyouxiangongsi', 'PATIKIL Graduated Dropper Pipette 50 ml, borosilicate', 'B0BCFJWMCR', 1, 37.49, 1.87, 3.74, 'L'],
  ['2025-09-27', 'CA592DBHFVMSI', '701-7011879-2363424', 'huizhouchuangyingjungongyinlianguanliyouxiangongsi', 'PATIKIL 8 Pack Reagent Storage Bottles 250 ml, GL45', 'B0CJV7TH4Q', 1, 38.99, 1.95, 3.89, 'L'],
  ['2025-09-27', 'CA5XGI7NM6YI', '701-7011879-2363424', 'Snugell LLC', 'Snugell Distilled Water 16.9 oz, 24-Pack', 'B0CHLDH5CF', 1, 69.99, 3.50, 6.98, 'M'],
  ['2025-09-28', 'CA51Y76EX1S6I', '701-7011879-2363424', 'J & D TECH INC', 'StonyLab Graduated Cylinder Combo 10/50/100 ml', 'B076GQ1BPS', 1, 27.99, 1.40, 2.79, 'L'],
  ['2025-09-28', 'CA51Y76EX1S6I', '701-7011879-2363424', 'J & D TECH INC', 'StonyLab Glass Beaker Set, 5 tailles (50 à 1000 ml)', 'B08HVDVKJP', 3, 29.99, 4.50, 8.97, 'L'],
  ['2025-09-28', 'CA53IF3EIH2I', '701-7011879-2363424', 'shenzhenshi', 'Lab Coat Unisex (blanc, Small)', 'B0C58T2J4J', 1, 23.89, 1.20, 2.38, 'L'],
  ['2025-09-28', 'CA54Z113ID7GI', '701-7011879-2363424', 'Thermopro Inc.', 'ThermoPro Wireless Thermometer 650 ft, Bluetooth', 'B08K2G5Y78', 1, 45.98, 2.30, 4.59, 'L'],
  ['2025-09-28', 'CA568HZQ3PGI', '701-7011879-2363424', 'shanghaiyizongmaoyiyouxiangongsi', 'Vevitts Lab Magnetic Stirrer Hot Plate 110 V', 'B0DM8H1727', 2, 69.99, 7.00, 13.96, 'L'],
  ['2025-09-28', 'CA5FXGQM2NI', '701-7011879-2363424', 'shenzhenshichuangshiyinxingkejiyouxiangongsi', 'AYINLAB Magnetic Stirrer Set (4 barreaux + 1 récupérateur), 3000 rpm', 'B0DPB2SLMZ', 1, 39.99, 2.00, 3.99, 'L'],
  ['2025-09-28', 'CA5T78ZREPQI', '701-7011879-2363424', 'DANGYANGSHIJUNNINGDIANZISHANGWUYOUXIANGONGSI', 'Wash bottle, 3 Pack LDPE Squeeze Bottles', 'B07MQTZJY6', 1, 11.99, 0.60, 1.20, 'L'],
  ['2025-12-16', 'CA55EALB30I', '701-5846022-7086667', 'WEF GmbH', 'WESERWEF Microfiber Glasses Cleaning Cloth', 'B0BJQQT5G7', 1, 19.99, 1.00, 1.99, 'B'],
  ['2025-12-16', 'CA5RRPTHQZ1I', '701-5846022-7086667', 'Qingdao Muxin Network Technology Co., Ltd', 'PJGGZ Men’s Bathrobe with Hood', 'B0DKNRYFW2', 1, 39.99, 2.00, 3.99, 'B'],
  ['2026-03-12', 'CA61BEE5FF0I', '701-7572672-5022637', 'Sophia L Beauty co. Ltd.', 'Pheromone Perfume For Women, Vanilla', 'B0D4LW69CN', 1, 11.99, 0.60, 1.20, 'B'],
  ['2026-03-30', 'CA69RHAVCKKI', '701-1627189-0199403', 'K18, INC.', 'K18 Leave-In Molecular Repair Hair Mask', 'B09HR5KSR8', 1, 41.50, 2.07, 4.14, 'B'],
  ['2026-03-30', 'CA610PLY7ACCUI', '701-7882887-9451410', 'Amazon.com.ca ULC', 'Moroccanoil Treatment Hair Oil Mist 0.85 fl oz', 'B0FH5S9WHC', 1, 26.00, 1.30, 2.59, 'B'],
  ['2026-06-29', 'CA61BKG84BR2I', '701-4027799-2085852', 'AMSON GLOBAL INC.', 'Citric Acid 5 lb / 2,27 kg, 100 % Pure Food Grade', 'B07581VJ8Y', 1, 29.99, 1.50, 0, 'M'],
  ['2026-06-29', 'CA6268GHTOOAI', '701-4027799-2085852', 'Suppléments Aromatik Inc', 'Pure Aloe Vera Drinkable Gel, Cold-Processed Organic', 'B07GJSRCDD', 1, 25.99, 1.30, 2.59, 'B'],
  ['2026-06-29', 'CA64CABX7B7SI', '701-4027799-2085852', 'NAKA SALES LIMITED', 'ORGANIC Aloe Vera 99 % Pure, Cold Pressed (340 ml)', 'B07S8YMS83', 1, 15.99, 0.80, 1.59, 'M'],
  ['2026-06-29', 'CA6ZLW6L7R6I', '701-4027799-2085852', '13038441 Canada Inc', 'PUROLEO Jojoba Oil 32 fl oz / 946 ml, 100 % pure', 'B09M7KWWS2', 1, 59.99, 3.00, 5.98, 'M'],
  ['2026-06-29', 'CA611CLMEMOI', '701-4693613-5823463', 'Kairos Blossoms Streams', 'Natural Hyaluronic Acid Powder (Sodium Hyaluronate) 25 g', 'B0CZZXWCYJ', 1, 24.00, 1.20, 2.39, 'M'],
  ['2026-06-29', 'CA62HAQW8MUI', '701-4693613-5823463', 'ROCKETROBIN.CA INC', 'Shea Butter Organic Unrefined Grade A, 1 kg', 'B0774TN3SL', 1, 29.99, 1.50, 2.99, 'M'],
  ['2026-06-29', 'CA64GCVZSXSI', '701-4693613-5823463', 'Nazli Sahin', 'Glycolic Acid Powder 1 oz, 99,9 % Cosmetic Grade', 'B0CZMNL9T7', 2, 26.00, 2.60, 5.18, 'M'],
  ['2026-06-29', 'CA653B7ZRZ4I', '701-4693613-5823463', 'Aromatika B.V.', 'Shea Butter 250 g, African Unrefined (Ghana)', 'B079MCCJBT', 1, 29.99, 1.50, 2.99, 'M'],
  ['2026-06-29', 'CA6C98GUVZOI', '701-4693613-5823463', 'MARUDHAR INC', 'Aloe Vera Gel Powder 200x, mi nature, 100 g', 'B0DPJ1LR16', 1, 26.99, 0, 2.69, 'M'],
  ['2026-06-30', 'CA62DJBHHD4I', '701-4693613-5823463', 'LINKERS', 'Myoc Hydrolyzed Wheat Protein, Cosmetic Grade, 50 g', 'B0CMX5NSY2', 1, 17.85, 0.89, 1.78, 'M'],
  ['2026-07-22', 'CA62E683TACCUI', '702-7655154-7833031', 'Amazon.com.ca ULC', 'Bounty Paper Towels Quick Size, 6 Family Triple Rolls', 'B0GGDMMVL5', 1, 29.99, 1.50, 2.99, 'G'],
  ['2026-07-22', 'CA61N6DC9A8I', '702-9052916-0596210', 'Madar Corporation Ltd', 'Mystic Moments Silk Amino Acid Powder 25 g', 'B01FSTJVVG', 1, 28.95, 0, 0, 'M'],
  ['2026-07-23', 'CA613SWX8W2MI', '702-7655154-7833031', 'LANON Protection LLC', 'LANON Disposable White Nitrile Gloves, sans latex ni poudre', 'B08698QB38', 1, 19.99, 1.00, 1.99, 'L'],
  ['2026-07-23', 'CA61VJJD433I', '702-7655154-7833031', 'LHOPEBK NATURE INC', 'Shea Butter Raw Organic 4.2 fl oz, Unrefined', 'B0G2Y668BT', 1, 14.99, 0.75, 1.49, 'M'],
  ['2026-07-23', 'CA62026EX1S6I', '702-7655154-7833031', 'J & D TECH INC', 'StonyLab 2-Pack 10 ml Graduated Cylinder', 'B07G7LJ3ZY', 2, 16.95, 1.70, 3.38, 'L'],
  ['2026-07-23', 'CA62026EX1S6I', '702-7655154-7833031', 'J & D TECH INC', 'Labasics Glass Beaker, Low Form Griffin (B0CP6WS8FH)', 'B0CP6WS8FH', 3, 9.99, 1.50, 3.00, 'L'],
  ['2026-07-23', 'CA62026EX1S6I', '702-7655154-7833031', 'J & D TECH INC', 'Labasics Glass Beaker, Low Form Griffin (B0CP6VTHV9)', 'B0CP6VTHV9', 3, 13.99, 2.10, 4.20, 'L'],
  ['2026-07-23', 'CA62026EX1S6I', '702-7655154-7833031', 'J & D TECH INC', 'Labasics Glass Beaker, Low Form Griffin (B0GS1XR6VM)', 'B0GS1XR6VM', 1, 8.99, 0.45, 0.90, 'L'],
  ['2026-07-23', 'CA62026EX1S6I', '702-7655154-7833031', 'J & D TECH INC', 'Labasics Glass Beaker, Low Form Griffin (B0CP6WM26D)', 'B0CP6WM26D', 3, 9.59, 1.44, 2.88, 'L'],
  ['2026-07-23', 'CA62EK0C4ACCUI', '702-7655154-7833031', 'Amazon.com.ca ULC', 'ALCAN Aluminum Foil Heavy Duty, 2-count (pack de 2)', 'B0BZ7MPGY3', 1, 19.99, 1.00, 1.99, 'G'],
  ['2026-07-23', 'CA62EK0C4ACCUI', '702-7655154-7833031', 'Amazon.com.ca ULC', 'Yupik Organic Brown Rice Protein Powder 1 kg, 80 %', 'B07HNQPGFK', 1, 28.85, 0, 0, 'M'],
  ['2026-07-23', 'CA62KUC0QL2I', '702-7655154-7833031', 'dongguanshiyiandianzishangwuyouxiangongshi', '30 ml Clear Small Glass Vials, 30 pcs with Screw Caps', 'B0BX96WGMY', 1, 29.99, 1.50, 2.99, 'L'],
  ['2026-07-23', 'CA67L7II7AYI', '702-7655154-7833031', 'Kaamkaaj Tools Inc.', '4 Pcs Stainless Steel Lab Spatula Set', 'B07MQKMYT3', 1, 13.99, 0.70, 1.40, 'L'],
  ['2026-07-23', 'CA6KBAVIHCPI', '702-7655154-7833031', 'HONG KONG LUMINOUS TRADING CO.', 'Covzoe 10 Pack Plastic Erlenmeyer Flask', 'B0D9YJKS23', 1, 27.99, 1.40, 2.79, 'L'],
  ['2026-07-23', 'CA6LINAG62I', '702-7655154-7833031', 'mian xue huang', 'Glass Pipette Dropper with Red Rubber Cap, 10 pcs', 'B01J9WKJIC', 1, 8.75, 0.44, 0.87, 'L'],
  ['2026-07-25', 'CA6NWRF8LA0SI', '701-2309198-5115448', 'Joels Wholesale LLC', 'Breadtopia Organic Diastatic Malt Powder 8 oz', 'B013ADVPZC', 1, 19.95, 1.00, 0, 'M'],
  ['2026-07-30', 'CA61LQHSLO0I', '702-0731374-6289035', 'zhe jiang hui li shi yan yi qi you xian gong si', 'LAB FISH OSC-20L Overhead Stirrer, 20 L, 100–2000 rpm, digital', 'B0CDZXHMV2', 1, 389.00, 19.45, 38.80, 'L'],
  ['2026-08-07', 'CA62YZBHHD4I', '701-4227950-3981863', 'LINKERS', 'MYOC Cetearyl Alcohol 8 oz / 227 g, Cosmetic Grade', 'B0D3QC8ZJ3', 2, 22.99, 2.14, 4.26, 'M', -1.61],
  ['2026-08-07', 'CA64YJM0PO0I', '701-6096839-0314613', 'QUANTUM STORE LLC', '2.2 lb BTMS 50 Conditioning Emulsifier', 'B0DK3HWSDH', 1, 100.70, 5.04, 10.04, 'M'],
  ['2026-09-11', 'CA64X6OGP7GI', '702-2575908-4705854', 'Eisco LLC', 'Eisco Labs Beaker, Euro Design, Polypropylene 500 ml', 'B00BHLE61K', 1, 21.31, 0, 0, 'L'],
  ['2026-09-11', 'CA64LU4XF28MI', '702-2807688-3237802', 'Hang Zhou Qi Wen Wang Luo Ke Ji You Xian', 'QWORK Laboratory Metalware Set, Lab Support Stand with Clamps', 'B0CF5NY4W4', 1, 30.97, 1.55, 3.09, 'L'],
  ['2026-09-11', 'CA67P8QKIQ2UI', '702-3442799-0521832', 'guangzhoushizhiyuanlaidianzishangwuyouxiangongsi', 'MECCANIXITY Borosilicate Glass Stir Rod 6 mm, 9.84 in', 'B0BB29B4MT', 1, 11.49, 0.57, 1.15, 'L'],
];

const r2 = (x) => Math.round(x * 100) / 100;

/** Factures regroupées par numéro Amazon, avec lignes, livraison, taxes et totaux tels que facturés. */
export function amazonInvoices() {
  const map = new Map();
  for (const [date, invoice, order, vendor, item, asin, qty, unit, tps, tvq, cat, discount = 0] of ROWS) {
    if (!map.has(invoice)) map.set(invoice, { invoice, order, date, lines: [], shipping: 0, subtotal: 0, tps: 0, tvq: 0 });
    const inv = map.get(invoice);
    const sub = r2(qty * (unit + discount));
    if (asin === '' && /livraison/i.test(item)) inv.shipping = r2(inv.shipping + sub);
    else { inv.lines.push({ item, vendor, asin, qty, unitPrice: unit, discount, subtotal: sub, tps, tvq, total: r2(sub + tps + tvq), category: CAT[cat] }); inv.subtotal = r2(inv.subtotal + sub); }
    inv.tps = r2(inv.tps + tps); inv.tvq = r2(inv.tvq + tvq);
  }
  for (const inv of map.values()) {
    inv.total = r2(inv.subtotal + inv.shipping + inv.tps + inv.tvq);
    const counts = {}; for (const l of inv.lines) counts[l.category] = (counts[l.category] || 0) + l.subtotal;
    inv.category = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }
  return [...map.values()];
}

export const amazonImported = () => db.all('invoices').some(i => i.importTag === AMAZON_TAG);

function ensureSupplier() {
  const found = db.all('suppliers').find(s => (s.name || '').trim().toLowerCase() === SUPPLIER_NAME.toLowerCase());
  if (found) return found;
  return db.insert('suppliers', { name: SUPPLIER_NAME, website: 'https://www.amazon.ca', city: 'Montréal', province: 'Québec', country: 'Canada', paymentTerms: 'Paiement à la commande', currency: 'CAD', categories: 'Matières premières, équipement de laboratoire, produits de référence, fournitures', notes: 'Créé lors de l’import des dépenses Amazon 2024–2026. Les vendeurs tiers figurent sur chaque ligne de facture.' });
}

export async function importAmazon(navigate) {
  const all = amazonInvoices();
  const done = new Set(db.all('invoices').filter(i => i.importTag === AMAZON_TAG).map(i => i.importKey));
  const todo = all.filter(i => !done.has(i.invoice));
  if (!todo.length) { toast('Les dépenses Amazon sont déjà importées.', 'warn'); return; }
  const total = todo.reduce((t, i) => t + i.total, 0);
  if (!await confirmDialog(`Importer ${todo.length} facture(s) Amazon de 2024 à 2026 (${total.toFixed(2).replace('.', ',')} $ taxes incluses) ? Chaque facture sera marquée payée par carte de crédit à sa date, sous le fournisseur « Amazon.ca ».`, { danger: false, label: 'Importer' })) return;
  const sup = ensureSupplier();
  let n = 0;
  for (const i of todo) {
    const desc = i.lines.map(l => l.item).join(' · ');
    const rec = db.insert('invoices', {
      number: i.invoice, supplierInvoiceNumber: `Commande ${i.order}`, supplierId: sup.id, purchaseId: '',
      date: i.date, dueDate: i.date, description: desc.length > 140 ? desc.slice(0, 137) + '…' : desc,
      subtotal: i.subtotal, shipping: i.shipping, applyTaxes: i.tps + i.tvq > 0, tps: i.tps, tvq: i.tvq, total: i.total,
      category: i.category, lines: i.lines,
      notes: 'Dépense Amazon importée du document « Dépenses totales Amazon ». Taxes telles que facturées (certains vendeurs ne facturent pas la TPS/TVQ).',
      importTag: AMAZON_TAG, importKey: i.invoice
    });
    db.insert('payments', { invoiceId: rec.id, amount: i.total, date: i.date, method: 'Carte de crédit', reference: i.order, notes: 'Réglé à la commande (import Amazon)', importTag: AMAZON_TAG, importKey: i.invoice });
    n++;
  }
  toast(`${n} facture(s) Amazon importée(s) et marquée(s) payée(s)`);
  navigate && navigate('invoices');
}
