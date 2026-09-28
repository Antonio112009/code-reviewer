---
name: Unsafe deserialization in Python
description: Code execution while loading data — pickle-family loaders (joblib, dill, shelve, pandas.read_pickle), yaml.load with unsafe loaders, torch.load before 2.6 / weights_only=False, numpy allow_pickle and pickle over multiprocessing connections.
priority: 80
tags: [CWE-502, OWASP-A08]
activation:
  content:
    - "\\b(?:c?[Pp]ickle|_pickle|cloudpickle|dill|joblib|shelve|marshal|jsonpickle)\\.(?:loads?|open|decode|Unpickler)\\b|\\bread_pickle\\s*\\("
    - "\\byaml\\.(?:load|load_all|unsafe_load|full_load)\\s*\\(|\\bLoader\\s*=\\s*(?:yaml\\.)?(?:Loader|UnsafeLoader|FullLoader)\\b"
    - "\\btorch\\.load\\s*\\(|\\bweights_only\\s*=\\s*False\\b|\\ballow_pickle\\s*=\\s*True\\b|\\btrust_remote_code\\s*=\\s*True\\b"
    - "\\bmultiprocessing\\.connection\\b|\\b(?:Listener|Client)\\s*\\([^)\\n]{0,120}\\bauthkey\\b"
  examples:
    - 'obj = pickle.loads(data)'
    - 'config = yaml.load(stream, Loader=yaml.Loader)'
    - 'model = torch.load(path, weights_only=False)'
    - 'listener = Listener(address, authkey=key)'
sources:
  - https://docs.python.org/3/library/pickle.html
  - https://github.com/yaml/pyyaml/blob/main/CHANGES
  - https://pytorch.org/blog/pytorch2-6/
  - https://numpy.org/doc/stable/reference/generated/numpy.load.html
---
- **Pickle-family loaders on external data**: `pickle`/`cPickle`, `dill`, `cloudpickle`, `joblib.load`, `shelve`, `marshal`, `jsonpickle.decode` and `pandas.read_pickle` run arbitrary code while loading → RCE from uploads, caches, queues, cookies or object storage. Fix: JSON/msgpack/protobuf; sign trusted blobs.
- **YAML loaders**: `yaml.load(s, Loader=yaml.Loader/UnsafeLoader)` and `yaml.unsafe_load` build arbitrary Python objects (`FullLoader` allowed code execution before PyYAML 5.4, CVE-2020-14343) → RCE. Fix: `yaml.safe_load`.
- **Model and array files**: `torch.load` with `weights_only=False` (the default before PyTorch 2.6), `numpy.load(allow_pickle=True)`, pickled scikit-learn/joblib models and `trust_remote_code=True` from untrusted sources execute code. Fix: `weights_only=True`, safetensors, pinned trusted revisions.
- **Pickle over the network**: `multiprocessing.connection` `Listener`/`Client` without `authkey`, and task queues or caches configured with pickle serializers, unpickle whatever reaches them → RCE. Fix: `authkey`, JSON serializers, network isolation.
- **Verify before loading**: base64 or "encrypted" pickled tokens that are decoded before any authentication check still reach the unpickler. Fix: verify an HMAC with `hmac.compare_digest` first, or drop pickle.
