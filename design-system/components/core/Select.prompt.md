قائمة منسدلة للتصفية — شريط `filter-selects` فوق البرنامج (تصفية حسب البيت/الفريق/اليوم).

```jsx
<div className="filter-selects">
  <Select options={["كل البيوت", "البيت الأول"]} value={g} onChange={setG} />
  <Select options={["كل الفرق", "خزيمة"]} value={t} onChange={setT} />
</div>
```

حد 1.5px، حلقة زرقاء عند التركيز. الخيار الأول دائماً «كل …».
