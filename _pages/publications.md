---
title: "Publications"
permalink: /publications/
excerpt: "Published papers by Kyungchan Cho and collaborators."
---

My published work in holography, entanglement, and machine learning.

{% assign papers = site.publications | sort: "date" | reverse %}
{% for paper in papers %}
{% include publication-entry.html paper=paper %}
{% endfor %}
