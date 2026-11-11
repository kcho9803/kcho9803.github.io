---
title: "CV"
permalink: /cv/
excerpt: "Education, research experience, publications, teaching, and selected scholarships."
redirect_from:
  - /resume
---

## Education

**Purdue University** · August 2024–present<br>
Physics PhD student, Department of Physics and Astronomy.<br>
Advisor: [Prof. Tyler Ellison](https://quantum.research.purdue.edu/directory/tyler-ellison/) (since August 2026).

**Gwangju Institute of Science and Technology (GIST)** · March 2017–August 2024<br>
B.S. in Physics, with minors in EECS and Mathematics.

## Research interests

Local decoding and autonomous error correction in topological quantum memories. Broader interests include quantum information and machine learning for physics.

## Research experience

**Purdue University** · August 2026–present<br>
Research with Prof. Tyler Ellison on local decoding for the toric code. I use mathematical analysis and simulation to study local update rules, including learned rules, under ongoing noise and faults in the decoder.

**High Energy Theory Lab, GIST**<br>
Undergraduate Research Assistant · May 2023–August 2024<br>
Undergraduate Intern · September 2020–June 2021<br>
Supervisor: Prof. Chanyong Park.

Research in holography, quantum entanglement, and machine learning. Additional research experience included Monte Carlo simulations using PyTorch under the supervision of Prof. Chi-Ok Hwang at the GIST Laboratory for Mathematical Sciences.

## Publications

{% assign papers = site.publications | sort: "date" | reverse %}
{% for paper in papers %}
<p><strong><a href="{{ paper.url | relative_url }}">{{ paper.title }}</a></strong><br>
{{ paper.authors }}<br>
<em>{{ paper.citation }}</em></p>
{% endfor %}

## Teaching

**Purdue University**

- **2026:** Graduate Teaching Assistant, PHYS 22100 — General Physics. Recitations and Physics Help Center office hours.
- **August 2024–December 2025:** Graduate Teaching Assistant, PHYS 22000 — General Physics. Physics Help Center office hours and Fall 2025 recitations.

**GIST**

- **February–June 2024:** Undergraduate Teaching Assistant, Discrete Mathematics. Assignment grading and submission guidelines.
- **March–June 2021:** Undergraduate Teaching Assistant, Mathematical Methods of Physics II. Assignment and exam grading.
- **September–December 2019:** Undergraduate Teaching Assistant, General Physics II. Grading and recitations.

## Selected scholarships

- **GIST study abroad scholarship, UC Berkeley** · January–May 2020.
- **GIST academic scholarships** · September 2017–February 2018 and March–August 2019.
- **GIST summer session abroad scholarship, UC Berkeley** · June–August 2018.
- **Government-sponsored scholarship at GIST** · March 2017–February 2023.

## Software and tools

PyTorch · LaTeX · Mathematica · MATLAB

## Profiles

[cho615@purdue.edu](mailto:cho615@purdue.edu)

[ORCID](https://orcid.org/0000-0002-7963-0165) · [GitHub](https://github.com/kcho9803) · [LinkedIn](https://www.linkedin.com/in/kyungchan-cho-388b48312/)
