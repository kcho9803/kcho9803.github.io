---
title: "Sitemap"
permalink: /sitemap/
sitemap: false
---

{% for link in site.data.navigation.main %}
- [{{ link.title }}]({{ link.url | relative_url }})
{% endfor %}

## Papers

{% for paper in site.publications reversed %}
- [{{ paper.title }}]({{ paper.url | relative_url }})
{% endfor %}
