import sys
open("scripts/gen_rest.py", "a").write("chunks.append(" + repr(sys.argv[1]) + ")\n")
