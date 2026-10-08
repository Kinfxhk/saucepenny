# Saucepenny · 菜本易

**English** · [繁體中文](#繁體中文)

> **🚧 In development · 開發中** — v0.1.0 is being built in the open. Nothing is released
> yet; numbers shown by development builds must not be relied on.

Saucepenny is a free, open-source, offline **recipe costing and menu pricing** tool for
small restaurants, cha chaan tengs, cafés, home bakers, private kitchens, social
enterprises, NGO kitchens and cookery classes. Enter what you pay for ingredients, how
much of each is usable after trimming, and your recipes (recipes can contain other
recipes, such as a sauce or a syrup). Saucepenny works out the cost of every recipe, the
**cost per portion**, the **food cost %** of every menu item and a **suggested price**.

- **Exact arithmetic.** Every amount is an exact fraction internally; nothing is rounded
  until it is shown. An **independent checker** recomputes every number a different way,
  and the two must agree exactly.
- Hong Kong units (斤, 兩) and HK$, plus g/kg, oz/lb, ml/L and US cups and spoons. All
  unit constants are cited from the law or from NIST ([docs/units.md](docs/units.md)).
- 10% service charge handled explicitly.
- No account, no server, no telemetry, no subscription. Your supplier prices stay in your
  browser.
- English and Traditional Chinese.
- Licence: [AGPL-3.0-or-later](LICENSE).

### Important

- **Estimates only, not accounting or tax advice.** Results depend entirely on the
  prices, yields and quantities you enter.
- Saucepenny does not calculate nutrition or allergens.
- Saucepenny is an independent project and is **not affiliated** with, endorsed by or
  sponsored by any other recipe-costing product or company.

## Contributing

Contributions are welcome under the rules in [CONTRIBUTING.md](CONTRIBUTING.md):
clean-room work only, every displayed number must be confirmed by the independent
checker, and commits are signed off (DCO). Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

**How it is made:** Saucepenny is written with AI coding agents working under the
maintainer's direction. That is why the project leans so hard on machine checking: an
independent checker must agree exactly with the costing engine, and golden, property and
mutation tests, a licence allowlist, a hygiene check and a secret scan run on every
change. Contributors may use AI tools too, under the
[AI-assisted development policy](CONTRIBUTING.md#ai-assisted-development).

## Commitments

Saucepenny will **never** have:

- **ads**;
- **tracking or analytics** of any kind, not even "anonymous";
- **paid unlocks**, subscriptions, per-outlet fees, usage limits or accounts.

The code stays open source under AGPL-3.0-or-later, so nobody can turn it into a closed
paid service without sharing their changes. Donations are optional and change nothing in
the app.

Source code: <https://github.com/Kinfxhk/saucepenny>

If Saucepenny helps you, you can support it at
[Buy Me a Coffee](https://buymeacoffee.com/kinfxhk).

---

## 繁體中文

> **🚧 開發中**：v0.1.0 正在公開開發，尚未發佈；開發版本顯示的數字不可作準。

菜本易（Saucepenny）是免費、開源、可離線使用的**食譜成本及餐牌定價**工具，適合小型
食肆、茶餐廳、咖啡店、家庭烘焙、私房菜、社企、非政府機構廚房及烹飪課。輸入食材買入價、
處理後的可用率及食譜（食譜可包含其他食譜，例如醬汁或糖水），菜本易即計出每個食譜的
成本、**每份成本**、每個餐牌項目的 **food cost %** 及**建議售價**。

- **精確計算：**內部所有數值都是精確分數，只在顯示時才四捨五入；另有**獨立檢查器**以
  另一種方法重算每個數字，兩者必須完全相同。
- 支援港式單位（斤、兩）及港幣，亦支援克、公斤、安士、磅、毫升、公升及美制杯、匙；所有
  單位常數均引用法例或 NIST 原文（[docs/units.md](docs/units.md)）。
- 清楚處理一成服務費。
- 無需帳戶、無伺服器、無遙測、無月費；供應商價錢只存於你的瀏覽器。
- 提供英文及繁體中文介面。
- 授權：[AGPL-3.0-or-later](LICENSE)。

### 重要事項

- **只供估算，並非會計或稅務意見。**結果完全取決於你輸入的價錢、可用率及用量。
- 菜本易不計算營養或致敏原。
- 菜本易是獨立項目，與任何其他食譜成本產品或公司**並無關連**，亦未獲其認可或贊助。

### 承諾

菜本易**永遠不會**有廣告、任何形式的追蹤或分析、付費解鎖、訂閱、按分店收費、用量限制或帳戶。
程式碼以 AGPL-3.0-or-later 開源；捐款純屬自願，不會改變程式任何功能。

### 開發方式及參與

菜本易由 AI 編程助手在維護者指示下撰寫。正因如此，項目非常依賴機器檢查：獨立檢查器必須與成本引擎
結果完全相同，每次修改都要通過標準答案測試、性質測試、變異測試、授權白名單、項目規範檢查及密鑰掃描。
歡迎貢獻，但須遵守 [CONTRIBUTING.md](CONTRIBUTING.md)（只可自行撰寫；如使用 AI 工具須逐行審閱、
負 DCO 責任並在 pull request 註明）及[行為守則](CODE_OF_CONDUCT.md)。

- 原始碼：<https://github.com/Kinfxhk/saucepenny>
- 支持項目：<https://buymeacoffee.com/kinfxhk>
