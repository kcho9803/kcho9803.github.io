---
permalink: /
title: "Local decoding for quantum error correction"
excerpt: "Kyungchan Cho is a Physics PhD student at Purdue University studying local decoding and autonomous error correction in topological quantum memories."
author_profile: true
research_hero: true
redirect_from:
  - /about/
  - /about.html
---

I'm **Kyungchan Cho**, a Physics PhD student in the [Department of Physics and Astronomy at Purdue University](https://www.physics.purdue.edu/), working with [Prof. Tyler Ellison](https://quantum.research.purdue.edu/directory/tyler-ellison/). I study **local decoding for topological quantum memories**, using the toric code as a test case.

My research asks how a decoder can keep correcting errors as they occur when it has access only to nearby information, has limited memory, and can itself be noisy. I use mathematical analysis and simulations to study both hand-designed and learned local update rules, with the goal of autonomous error correction.

My earlier research at the Gwangju Institute of Science and Technology (GIST) explored holography, entanglement, and machine learning. I remain interested in the connections between quantum information and learning methods in physics.

## Published work

{% assign papers = site.publications | sort: "date" | reverse %}
{% for paper in papers %}
{% include publication-entry.html paper=paper %}
{% endfor %}

## Writing

I write short explanations of my published research and the ideas behind it. My [writing page]({{ '/writing/' | relative_url }}) collects these articles.

## Contact

[cho615@purdue.edu](mailto:cho615@purdue.edu)

[ORCID](https://orcid.org/0000-0002-7963-0165) · [GitHub](https://github.com/kcho9803) · [LinkedIn](https://www.linkedin.com/in/kyungchan-cho-388b48312/)
