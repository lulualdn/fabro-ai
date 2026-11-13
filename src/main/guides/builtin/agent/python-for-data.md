---
name: agent/python-for-data
title: Python for data tasks (CSV, Excel, charts, calculations)
when: Calculations, statistics, CSV/Excel processing, charts, conversions
keywords: python, csv, excel, xlsx, data, données, chart, graphique, calcul, statistics, statistiques, pandas, moyenne, average
---

- Use run_python (or write a .py file and run it). Print the results you will report.
- Read data: `pandas.read_csv(path)`, `pandas.read_excel(path)`; first print `df.shape`, `df.columns`, `df.head()`.
- Calculations: let Python compute; never do arithmetic in your head for reports.
- Charts: matplotlib → `plt.savefig(full_path)`; then report the path.
- Missing package: install it (`pip install pandas openpyxl matplotlib`) then rerun.
- Report numbers exactly as printed, with units. If the script failed, show the error and fix it — don't report expected values.
