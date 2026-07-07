زر المنصّة الأساسي — استخدمه لكل الأفعال؛ `primary` للفعل الرئيسي الواحد في الشاشة.

```jsx
<Button variant="primary">إدخال النتيجة</Button>
<Button>إلغاء</Button>
<Button variant="sun">🏆 شارك في المسابقة</Button>
<Button variant="danger" size="sm">حذف</Button>
```

- `primary`: أزرق بظل صلب سفلي (ينكبس عند الضغط — `translateY(3px)`).
- `sun`: ذهبي للأفعال الاحتفالية (جوائز، انضمام لمسابقة).
- `outline` / `danger` / `sm` / `block` كما في الكود الأصلي.
- نص الزر بوزن 700؛ لا أحرف كبيرة/صغيرة (عربي).
