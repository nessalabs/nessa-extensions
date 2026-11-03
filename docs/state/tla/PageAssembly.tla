-------------------- MODULE PageAssembly --------------------
EXTENDS Naturals, Sequences, FiniteSets
VARIABLES phase, parts
vars == <<phase, parts>>
Init == /\ phase = "Reading" /\ parts = <<>>
Receive(revision, offset) ==
  /\ phase \in {"Reading", "Assembling"}
  /\ LET revisionOK == IF Len(parts) = 0 THEN TRUE ELSE revision = parts[1].revision
         offsetOK == offset = Len(parts) + 1
     IN IF revisionOK /\ offsetOK
        THEN /\ parts' = Append(parts, [revision |-> revision, offset |-> offset])
             /\ phase' = IF Len(parts') = 2 THEN "Complete" ELSE "Assembling"
        ELSE /\ phase' = "Refused" /\ UNCHANGED parts
Retire == /\ phase = "Assembling" /\ phase' = "Retired" /\ UNCHANGED parts
Next == (\E revision \in {1, 2}, offset \in {1, 2} : Receive(revision, offset)) \/ Retire
Spec == Init /\ [][Next]_vars
OneRevision == phase = "Complete" => parts[1].revision = parts[2].revision
ContiguousPages == phase = "Complete" => /\ parts[1].offset = 1 /\ parts[2].offset = 2
=============================================================
