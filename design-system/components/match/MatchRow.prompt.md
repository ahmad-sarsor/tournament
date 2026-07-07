صف مباراة — البنية الأصلية من `render.js`: عمود الوقت (+البيت/شارة مباشر)، ثم مضيف — نتيجة — ضيف، وسهم للتفاصيل.

```jsx
<MatchRow time="17:00" group="البيت الأول" homeName="خزيمة" awayName="أسامة بن زيد"
          homeScore={3} awayScore={1} status="finished" onClick={openMatch} />
<MatchRow time="18:00" homeName="القعقاع" awayName="عمر بن الخطاب"
          homeScore={2} awayScore={2} status="live" />
<MatchRow time="19:00" homeName="بلال بن رباح" awayName="خالد بن الوليد" />
```

- الفائز اسمه أسمك وأغمق تلقائياً.
- `live`: إطار أحمر، النتيجة حمراء ممتلئة، شارة «مباشر» نابضة تحت الوقت.
- المجدولة تعرض «–» بدل النتيجة.
- تُجمَّع الصفوف تحت `day-head` (اسم اليوم + التاريخ + خط).
